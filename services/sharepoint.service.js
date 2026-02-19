import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();



class SharePointService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.driveId = null;
    this.isConfigured = false;
    this.initialize();
  }

  /**
   * Initialize SharePoint service configuration
   */
  initialize() {
    this.siteUrl = process.env.SHAREPOINT_SITE_URL;
    this.tenantId = process.env.AZURE_TENANT_ID;
    this.clientId = process.env.AZURE_CLIENT_ID;
    this.clientSecret = process.env.AZURE_CLIENT_SECRET;
    this.documentLibrary = process.env.SHAREPOINT_DOCUMENT_LIBRARY || 'Documents';

    if (!this.siteUrl || !this.tenantId || !this.clientId || !this.clientSecret) {
      console.warn('SharePoint service not configured. Required: SHAREPOINT_SITE_URL, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET');
      this.isConfigured = false;
      return;
    }

    // Extract site host and path from URL
    try {
      const url = new URL(this.siteUrl);
      this.siteHost = url.hostname;
      this.sitePath = url.pathname;
      this.isConfigured = true;
      console.log('SharePoint service initialized');
    } catch (error) {
      console.error('Invalid SharePoint site URL', { url: this.siteUrl, error: error.message });
      this.isConfigured = false;
    }
  }


  async getAccessToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;

    try {
      const response = await axios.post(tokenUrl, new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      this.accessToken = response.data.access_token;
      // Set expiry 5 minutes before actual expiry for safety
      this.tokenExpiry = new Date(Date.now() + (response.data.expires_in - 300) * 1000);

      console.log('SharePoint access token obtained');
      return this.accessToken;
    } catch (error) {
      console.error('Failed to get SharePoint access token', { 
        error: error.response?.data || error.message 
      });
      throw new Error('Failed to authenticate with SharePoint');
    }
  }

  /**
   * Get the Graph API base URL for the SharePoint site drive
   * @returns {Promise<string>} Site drive URL
   */
  async getSiteDriveUrl() {
    if (this.driveId) {
      return `https://graph.microsoft.com/v1.0/drives/${this.driveId}`;
    }

    const token = await this.getAccessToken();

    try {
      // Get site ID first
      const siteResponse = await axios.get(
        `https://graph.microsoft.com/v1.0/sites/${this.siteHost}:${this.sitePath}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      const siteId = siteResponse.data.id;
      
      // Get document library (drive) by name
      const drivesResponse = await axios.get(
        `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      // Find the drive with matching name
      const drive = drivesResponse.data.value.find(d => d.name === this.documentLibrary);
      
      if (!drive) {
        throw new Error(`Document library '${this.documentLibrary}' not found`);
      }
      
      this.driveId = drive.id;
      return `https://graph.microsoft.com/v1.0/drives/${this.driveId}`;
    } catch (error) {
      console.error('Failed to get SharePoint site drive', { 
        error: error.response?.data || error.message 
      });
      throw new Error(`Failed to access SharePoint site: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Ensure folder path exists in SharePoint, creating if necessary
   * @param {string} folderPath - Folder path (e.g., "PerformanceDocuments/UC388/Quarter-Q1-2025")
   * @returns {Promise<string>} Folder path
   */
  async ensureFolderPath(folderPath) {
    const token = await this.getAccessToken();
    const driveUrl = await this.getSiteDriveUrl();
    
    // Split path and create each folder level
    const pathParts = folderPath.split('/').filter(p => p.length > 0);
    let currentPath = '';
    
    for (const part of pathParts) {
      const parentPath = currentPath || 'root';
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      try {
        // Check if folder exists
        await axios.get(
          `${driveUrl}/root:/${currentPath}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch (error) {
        if (error.response?.status === 404) {
          // Folder doesn't exist, create it
          try {
            const createUrl = parentPath === 'root' 
              ? `${driveUrl}/root/children`
              : `${driveUrl}/root:/${parentPath.replace(/\/$/, '')}:/children`;
            
            await axios.post(createUrl, {
              name: part,
              folder: {},
              '@microsoft.graph.conflictBehavior': 'fail'
            }, {
              headers: { 
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            });
            
            console.log('Created SharePoint folder', { path: currentPath });
          } catch (createError) {
            // Ignore conflict error (folder already exists)
            if (createError.response?.status !== 409) {
              console.error('Error creating folder', { path: currentPath, error: createError.response?.data || createError.message });
              throw createError;
            }
          }
        } else {
          throw error;
        }
      }
    }
    
    return currentPath;
  }

  /**
   * Upload file to SharePoint
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} fileName - File name
   * @param {string} folderPath - Folder path (e.g., "PerformanceDocuments/UC388/Quarter-Q1-2025")
   * @returns {Promise<string>} SharePoint file web URL
   */
  async uploadFile(fileBuffer, fileName, folderPath) {
    if (!this.isConfigured) {
      throw new Error('SharePoint service is not configured');
    }

    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error('File buffer is required');
    }

    if (!fileName) {
      throw new Error('File name is required');
    }

    try {
      const token = await this.getAccessToken();
      const driveUrl = await this.getSiteDriveUrl();

      // Ensure folder exists
      await this.ensureFolderPath(folderPath);

      const fileSize = fileBuffer.length;
      let uploadResult;

      // Use simple upload for files < 4MB, resumable upload for larger files
      if (fileSize < 4 * 1024 * 1024) {
        // Simple upload
        uploadResult = await axios.put(
          `${driveUrl}/root:/${folderPath}/${fileName}:/content`,
          fileBuffer,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/pdf'
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          }
        );
      } else {
        // Large file upload using upload session
        uploadResult = await this.uploadLargeFile(
          driveUrl, 
          token, 
          folderPath, 
          fileName, 
          fileBuffer
        );
      }

      const webUrl = uploadResult.data?.webUrl;
      
      if (!webUrl) {
        throw new Error('Upload succeeded but no web URL returned');
      }

      console.log('File uploaded to SharePoint', {
        fileName,
        folderPath,
        webUrl
      });

      return webUrl;
    } catch (error) {
      console.error('Failed to upload file to SharePoint', {
        error: error.response?.data || error.message,
        fileName,
        folderPath
      });
      
      throw new Error(`SharePoint upload failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Upload large file using resumable upload session
   * @private
   */
  async uploadLargeFile(driveUrl, token, folderPath, fileName, fileBuffer) {
    // Create upload session
    const sessionResponse = await axios.post(
      `${driveUrl}/root:/${folderPath}/${fileName}:/createUploadSession`,
      {
        item: {
          '@microsoft.graph.conflictBehavior': 'replace',
          name: fileName
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const uploadUrl = sessionResponse.data.uploadUrl;
    const fileSize = fileBuffer.length;
    const chunkSize = 10 * 1024 * 1024; // 10MB chunks
    let offset = 0;

    while (offset < fileSize) {
      const end = Math.min(offset + chunkSize, fileSize);
      const chunk = fileBuffer.slice(offset, end);

      const response = await axios.put(uploadUrl, chunk, {
        headers: {
          'Content-Length': chunk.length.toString(),
          'Content-Range': `bytes ${offset}-${end - 1}/${fileSize}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      // If upload is complete, return the result
      if (response.status === 200 || response.status === 201) {
        return response;
      }

      offset = end;
    }

    throw new Error('Large file upload did not complete successfully');
  }

  /**
   * Delete a file from SharePoint
   * @param {string} fileUrl - SharePoint file web URL
   * @returns {Promise<boolean>}
   */
  async deleteFile(fileUrl) {
    if (!this.isConfigured) {
      return false;
    }

    try {
      const token = await this.getAccessToken();
      const driveUrl = await this.getSiteDriveUrl();

      // Extract path from SharePoint web URL
      // Format: https://site.sharepoint.com/sites/SiteName/Shared%20Documents/PerformanceDocuments/...
      const urlObj = new URL(fileUrl);
      const urlPath = urlObj.pathname;
      
      // Find the path after the document library name
      // Common patterns: /Shared%20Documents/, /Documents/, or custom library name
      const pathParts = urlPath.split('/').filter(p => p);
      
      // Find document library in path (could be "Shared%20Documents", "Documents", or custom name)
      let libIndex = -1;
      for (let i = 0; i < pathParts.length; i++) {
        const decoded = decodeURIComponent(pathParts[i]);
        if (decoded === this.documentLibrary || decoded === 'Shared Documents' || decoded === 'Documents') {
          libIndex = i;
          break;
        }
      }
      
      if (libIndex === -1) {
        // Try to find path after site path
        const sitePathParts = this.sitePath.split('/').filter(p => p);
        const siteIndex = pathParts.findIndex((p, idx) => 
          sitePathParts.every((sp, sidx) => pathParts[idx + sidx] === sp)
        );
        
        if (siteIndex >= 0) {
          // Path starts after site path
          const relativePath = pathParts.slice(siteIndex + sitePathParts.length).join('/');
          await axios.delete(
            `${driveUrl}/root:/${decodeURIComponent(relativePath)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
        } else {
          throw new Error('Could not extract file path from URL');
        }
      } else {
        // Extract path after document library
        const relativePath = pathParts.slice(libIndex + 1).map(p => decodeURIComponent(p)).join('/');
        await axios.delete(
          `${driveUrl}/root:/${relativePath}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      console.log('File deleted from SharePoint', { fileUrl });
      return true;
    } catch (error) {
      console.error('Failed to delete file from SharePoint', {
        error: error.response?.data || error.message,
        fileUrl
      });
      return false;
    }
  }

  /**
   * Check if SharePoint service is configured and working
   * @returns {Promise<Object>}
   */
  async healthCheck() {
    if (!this.isConfigured) {
      return { healthy: false, message: 'SharePoint service not configured' };
    }

    try {
      await this.getAccessToken();
      await this.getSiteDriveUrl();
      return { healthy: true, message: 'SharePoint service is operational' };
    } catch (error) {
      return { 
        healthy: false, 
        message: `SharePoint service error: ${error.message}` 
      };
    }
  }
}

// Export singleton instance
const sharePointService = new SharePointService();

export default sharePointService;

// Export individual functions for backward compatibility
export async function uploadFileToSharePoint(fileBuffer, fileName, folderPath) {
  return sharePointService.uploadFile(fileBuffer, fileName, folderPath);
}

export async function deleteFileFromSharePoint(fileUrl) {
  return sharePointService.deleteFile(fileUrl);
}

export async function getFileDownloadUrl(fileUrl) {
  // For Graph API, the webUrl is already the download URL
  return fileUrl;
}

export async function fileExistsInSharePoint(fileUrl) {
  try {
    const token = await sharePointService.getAccessToken();
    const driveUrl = await sharePointService.getSiteDriveUrl();
    
    // Extract path from SharePoint web URL (same logic as deleteFile)
    const urlObj = new URL(fileUrl);
    const urlPath = urlObj.pathname;
    const pathParts = urlPath.split('/').filter(p => p);
    
    // Find document library in path
    let libIndex = -1;
    for (let i = 0; i < pathParts.length; i++) {
      const decoded = decodeURIComponent(pathParts[i]);
      if (decoded === sharePointService.documentLibrary || decoded === 'Shared Documents' || decoded === 'Documents') {
        libIndex = i;
        break;
      }
    }
    
    let relativePath;
    if (libIndex >= 0) {
      relativePath = pathParts.slice(libIndex + 1).map(p => decodeURIComponent(p)).join('/');
    } else {
      // Try to find path after site path
      const sitePathParts = sharePointService.sitePath.split('/').filter(p => p);
      const siteIndex = pathParts.findIndex((p, idx) => 
        sitePathParts.every((sp, sidx) => pathParts[idx + sidx] === sp)
      );
      
      if (siteIndex >= 0) {
        relativePath = pathParts.slice(siteIndex + sitePathParts.length).map(p => decodeURIComponent(p)).join('/');
      } else {
        return false;
      }
    }
    
    await axios.get(
      `${driveUrl}/root:/${relativePath}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    return true;
  } catch (error) {
    return false;
  }
}
