import { query } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

const USER_MASTER_API_BASE_URL = process.env.USER_MASTER_API || 'https://people.utthunga.io/api/user-master/search';


export const fetchEmployeeFromUserMaster = async (employeeCode) => {
  if (!employeeCode) {
    console.warn('[UserMasterAPI] Employee code is required');
    return null;
  }

  try {
    const url = `${USER_MASTER_API_BASE_URL}?employee_code=${encodeURIComponent(employeeCode)}`;
    
    console.log(`[UserMasterAPI] Fetching employee data for code: ${employeeCode}`);
    
    // Create AbortController for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[UserMasterAPI] Employee not found: ${employeeCode}`);
        return null;
      }
      throw new Error(`User Master API returned status ${response.status}`);
    }

    const data = await response.json();
    
    console.log(`[UserMasterAPI] Raw API response for ${employeeCode}:`, JSON.stringify(data, null, 2));
    

    let employeeData = null;
    
    if (Array.isArray(data)) {
      // If response is an array, take the first item
      employeeData = data[0];
    } else if (data.data) {
      employeeData = Array.isArray(data.data) ? data.data[0] : data.data;
    } else if (data.result) {
      employeeData = Array.isArray(data.result) ? data.result[0] : data.result;
    } else {
      employeeData = data;
    }
    
    if (!employeeData) {
      console.warn(`[UserMasterAPI] No employee data found in response for: ${employeeCode}`);
      return null;
    }
    
    if (!employeeData.employeeCode && !employeeData.employee_code) {
      console.warn(`[UserMasterAPI] Invalid response format - no employeeCode found for: ${employeeCode}`);
      console.warn(`[UserMasterAPI] Available keys:`, Object.keys(employeeData));
      return null;
    }

    // Normalize field names (handle both camelCase and snake_case)
    const normalizedData = {
      ...employeeData,
      employeeCode: employeeData.employeeCode || employeeData.employee_code,
      fullName: employeeData.fullName || employeeData.full_name,
      workEmail: employeeData.workEmail || employeeData.work_email || employeeData.email,
      department: employeeData.department,
      subDepartment: employeeData.subDepartment || employeeData.sub_department || employeeData.subDepartment,
      reportingManagerCode: employeeData.reportingManagerCode || employeeData.reporting_manager_code,
      deputedLocation: employeeData.deputedLocation || employeeData.deputed_location || employeeData.location,
      employeeStatus: employeeData.employeeStatus || employeeData.employee_status || employeeData.status,
      dateOfJoining: employeeData.dateOfJoining || employeeData.date_of_joining,
      grade: employeeData.grade || employeeData.grade_level || employeeData.level
    };

    console.log(`[UserMasterAPI] Successfully fetched data for employee: ${employeeCode}`);
    console.log(`[UserMasterAPI] Normalized data structure:`, {
      employeeCode: normalizedData.employeeCode,
      hasDepartment: !!normalizedData.department,
      hasSubDepartment: !!normalizedData.subDepartment,
      hasReportingManagerCode: !!normalizedData.reportingManagerCode,
      department: normalizedData.department,
      subDepartment: normalizedData.subDepartment,
      reportingManagerCode: normalizedData.reportingManagerCode,
      allKeys: Object.keys(employeeData)
    });
    
    return normalizedData;
  } catch (error) {
    // Handle timeout and network errors gracefully
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error(`[UserMasterAPI] Request timeout for employee: ${employeeCode}`);
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error(`[UserMasterAPI] Network error fetching employee: ${employeeCode}`, error.message);
    } else {
      console.error(`[UserMasterAPI] Error fetching employee ${employeeCode}:`, error.message);
    }
    
    // Don't throw - return null to allow login to proceed even if API fails
    return null;
  }
};

/**
 * Fetches employee data from User Master API by email
 * @param {string} email - Email address to search for
 * @returns {Promise<Object|null>} Normalized employee data or null if not found/error
 */
export const fetchEmployeeFromUserMasterByEmail = async (email) => {
  if (!email) {
    console.warn('[UserMasterAPI] Email is required');
    return null;
  }

  try {
    const url = `${USER_MASTER_API_BASE_URL}?email=${encodeURIComponent(email)}`;
    
    console.log(`[UserMasterAPI] Fetching employee data for email: ${email}`);
    
    // Create AbortController for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[UserMasterAPI] Employee not found for email: ${email}`);
        return null;
      }
      throw new Error(`User Master API returned status ${response.status}`);
    }

    const data = await response.json();
    let employeeData = null;
    
    if (Array.isArray(data)) {
      employeeData = data[0];
      console.log(` data from user master api by email employee`, JSON.stringify(employeeData, null, 2));
    } else if (data.data) {
      employeeData = Array.isArray(data.data) ? data.data[0] : data.data;
    } else if (data.result) {
      employeeData = Array.isArray(data.result) ? data.result[0] : data.result;
    } else {
      employeeData = data;
    }
    
    if (!employeeData) {
      console.warn(`[UserMasterAPI] No employee data found in response for email: ${email}`);
      return null;
    }
    
    if (!employeeData.employeeCode && !employeeData.employee_code) {
      console.warn(`[UserMasterAPI] Invalid response format - no employeeCode found for email: ${email}`);
      return null;
    }

    // Normalize field names (handle both camelCase and snake_case)
    const normalizedData = {
      ...employeeData,
      employeeCode: employeeData.employeeCode || employeeData.employee_code,
      fullName: employeeData.fullName || employeeData.full_name,
      workEmail: employeeData.workEmail || employeeData.work_email || employeeData.email,
      department: employeeData.department,
      subDepartment: employeeData.subDepartment || employeeData.sub_department || employeeData.subDepartment,
      reportingManagerCode: employeeData.reportingManagerCode || employeeData.reporting_manager_code,
      deputedLocation: employeeData.deputedLocation || employeeData.deputed_location || employeeData.location,
      employeeStatus: employeeData.employeeStatus || employeeData.employee_status || employeeData.status,
      dateOfJoining: employeeData.dateOfJoining || employeeData.date_of_joining,
      grade: employeeData.grade || employeeData.grade_level || employeeData.level
    };

    console.log(`[UserMasterAPI] Successfully fetched data for email: ${email}`);
    
    return normalizedData;
  } catch (error) {
    // Handle timeout and network errors gracefully
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error(`[UserMasterAPI] Request timeout for email: ${email}`);
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error(`[UserMasterAPI] Network error fetching employee by email: ${email}`, error.message);
    } else {
      console.error(`[UserMasterAPI] Error fetching employee by email ${email}:`, error.message);
    }
    
    // Don't throw - return null to allow login to proceed even if API fails
    return null;
  }
};

/**
 * Checks if employee data needs to be synced from User Master API
 * @param {Object} existingEmployee - Existing employee record from database
 * @returns {boolean} True if sync is needed
 */
export const shouldSyncEmployeeData = (existingEmployee) => {
  if (!existingEmployee) {
    return true; // New employee, sync needed
  }
  
  // Check if critical fields are missing or have default values
  if (existingEmployee.department === 'Unassigned' || 
      existingEmployee.business_unit === 'Unassigned' ||
      !existingEmployee.department ||
      !existingEmployee.sub_department) {
    console.log(`[UserMasterAPI] Employee ${existingEmployee.emp_code} needs sync - has unassigned/missing values`);
    return true;
  }

  // Always sync on login to ensure data is up-to-date
  // But we'll check for actual changes before updating
  return true;
};

/**
 * Syncs employee data from User Master API to the employees table
 * Only updates specified fields: department, sub_department, manager_code, location, date_of_joining
 * @param {string} profileId - Profile ID of the user
 * @param {string} email - Email address
 * @param {string} employeeCode - Employee code (optional, will be fetched if not provided)
 * @returns {Promise<boolean>} True if sync was successful, false otherwise
 */
export const syncEmployeeDataFromUserMaster = async (profileId, email, employeeCode = null) => {
  try {
    console.log(`[UserMasterAPI] Starting sync for profileId: ${profileId}, email: ${email}, employeeCode: ${employeeCode || 'not provided'}`);
    
    let userMasterData = null;
    
    if (employeeCode) {
      console.log(`[UserMasterAPI] Fetching by employee_code: ${employeeCode}`);
      // Email/password login: prefer employee_code
      userMasterData = await fetchEmployeeFromUserMaster(employeeCode);
    } else {
      // SSO login (and fallback): use email
      console.log(`[UserMasterAPI] Fetching by email: ${email}`);
      userMasterData = await fetchEmployeeFromUserMasterByEmail(email);
    }

    if (!userMasterData) {
      console.warn(`[UserMasterAPI] No data found from User Master API for ${employeeCode || email}`);
      return false;
    }

    console.log(`[UserMasterAPI] Received data from User Master API:`, {
      employeeCode: userMasterData.employeeCode,
      department: userMasterData.department,
      subDepartment: userMasterData.subDepartment,
      reportingManagerCode: userMasterData.reportingManagerCode,
      deputedLocation: userMasterData.deputedLocation,
      dateOfJoining: userMasterData.dateOfJoining
    });

    // Employee code can change in User Master; always locate by profile_id/email primarily
    const empResult = await query(
      'SELECT * FROM employees WHERE profile_id = $1 OR email = $2 LIMIT 1',
      [profileId, email]
    );

    let existingEmployee = null;
    
    if (empResult.rows.length === 0) {
      // Employee record doesn't exist - create it with User Master data
      const finalEmployeeCode = employeeCode || userMasterData.employeeCode;
      console.log(`[UserMasterAPI] No employee record found for ${email}, creating new record (emp_code=${finalEmployeeCode || 'missing'})`);
      
      try {
        const employeeId = uuidv4();
        
        // Get full_name from profile if available
        const profileResult = await query(
          'SELECT full_name FROM profiles WHERE id = $1',
          [profileId]
        );
        const fullName = profileResult.rows.length > 0 ? profileResult.rows[0].full_name : userMasterData.fullName || 'User';
        
        // Create employee record with User Master data
        const insertResult = await query(
          `INSERT INTO employees (id, emp_code, profile_id, full_name, email, department, 
           business_unit, grade, location, sub_department, manager_code, date_of_joining, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
           RETURNING *`,
          [
            employeeId,
            finalEmployeeCode,
            profileId,
            fullName,
            email,
            userMasterData.department || 'Unassigned',
            'Unassigned', // business_unit not in User Master
            userMasterData.grade || 'Unassigned', // Use grade from User Master if available
            userMasterData.deputedLocation || 'Unassigned',
            userMasterData.subDepartment || null,
            userMasterData.reportingManagerCode || null, // Use reportingManagerCode directly
            userMasterData.dateOfJoining || new Date().toISOString().split('T')[0],
            'active'
          ]
        );
        
        existingEmployee = insertResult.rows[0];
        console.log(`[UserMasterAPI] Created new employee record with ID: ${employeeId}`);
        return true; // Successfully created with User Master data
        } catch (createError) {
        console.error(`[UserMasterAPI] Error creating employee record:`, createError);
        // If creation fails (e.g., duplicate emp_code), try to find the existing record
        const retryResult = await query(
          'SELECT * FROM employees WHERE profile_id = $1 OR email = $2 LIMIT 1',
          [profileId, email]
        );
        if (retryResult.rows.length > 0) {
          existingEmployee = retryResult.rows[0];
          console.log(`[UserMasterAPI] Found existing employee record after creation failure`);
        } else {
          console.error(`[UserMasterAPI] Could not create or find employee record, skipping sync`);
          return false;
        }
      }
    } else {
      existingEmployee = empResult.rows[0];
    }

    // Sync emp_code ONLY if changed (and avoid collisions)
    const userMasterEmpCode = userMasterData.employeeCode || null;
    if (userMasterEmpCode && existingEmployee.emp_code !== userMasterEmpCode) {
      const conflict = await query(
        'SELECT id FROM employees WHERE emp_code = $1 AND id <> $2 LIMIT 1',
        [userMasterEmpCode, existingEmployee.id]
      );

      if (conflict.rows.length > 0) {
        console.warn(`[UserMasterAPI] Skipping emp_code update: ${userMasterEmpCode} already belongs to another employee`);
      } else {
        await query(
          'UPDATE employees SET emp_code = $1, updated_at = NOW() WHERE id = $2',
          [userMasterEmpCode, existingEmployee.id]
        );
        existingEmployee.emp_code = userMasterEmpCode;
        console.log(`[UserMasterAPI] Updated emp_code to ${userMasterEmpCode} for employee id=${existingEmployee.id}`);
      }
    }
    console.log(`[UserMasterAPI] Found existing employee record:`, {
      id: existingEmployee.id,
      emp_code: existingEmployee.emp_code,
      department: existingEmployee.department,
      sub_department: existingEmployee.sub_department,
      manager_code: existingEmployee.manager_code,
      location: existingEmployee.location,
      date_of_joining: existingEmployee.date_of_joining
    });

    // Prepare update fields - only update specified fields
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    // Map User Master fields to database fields
    const fieldMappings = {
      department: userMasterData.department,
      sub_department: userMasterData.subDepartment,
      manager_code: userMasterData.reportingManagerCode, // Map reportingManagerCode to manager_code
      location: userMasterData.deputedLocation,
      date_of_joining: userMasterData.dateOfJoining,
      grade: userMasterData.grade // Include grade in updates
    };

    // Only update fields that have changed and are not null/undefined
    // Always update if User Master has data, even if current value is 'Unassigned' or similar
    for (const [dbField, userMasterValue] of Object.entries(fieldMappings)) {
      // Skip if User Master value is null/undefined/empty
      if (userMasterValue === null || userMasterValue === undefined || String(userMasterValue).trim() === '') {
        console.log(`[UserMasterAPI] Skipping ${dbField} - User Master value is null/undefined/empty: ${userMasterValue}`);
        continue;
      }

      const currentValue = existingEmployee[dbField];
      
      // Special handling for date fields - compare as strings
      let hasChanged = false;
      let valueToStore = null;
      
      if (dbField === 'date_of_joining') {
        // Convert both to ISO date strings for comparison (YYYY-MM-DD)
        const currentDateStr = currentValue 
          ? (currentValue instanceof Date 
              ? currentValue.toISOString().split('T')[0] 
              : String(currentValue).split('T')[0])
          : null;
        const newDateStr = String(userMasterValue).split('T')[0];
        hasChanged = currentDateStr !== newDateStr;
        valueToStore = newDateStr;
        console.log(`[UserMasterAPI] Date comparison for ${dbField}: current="${currentDateStr}", new="${newDateStr}", changed=${hasChanged}`);
      } else {
        // For other fields, normalize and compare
        // Treat NULL, empty string, and 'Unassigned' as equivalent for comparison
        const currentStr = currentValue 
          ? String(currentValue).trim().toLowerCase() 
          : '';
        const newStr = String(userMasterValue).trim();
        
        // Special handling for manager_code - always update if we have a value from User Master
        if (dbField === 'manager_code') {
          // Always update manager_code if User Master provides it and it's different
          hasChanged = currentStr !== newStr.toLowerCase();
          valueToStore = newStr; // Store the actual value from User Master
          console.log(`[UserMasterAPI] manager_code comparison: current="${currentValue || '(null)'}", new="${newStr}", changed=${hasChanged}`);
        } else {
          // Always update if current is 'Unassigned' or empty, or if values differ
          const isUnassigned = currentStr === '' || currentStr === 'unassigned' || currentStr === 'null';
          hasChanged = isUnassigned || currentStr !== newStr.toLowerCase();
          valueToStore = newStr; // Store the actual value from User Master
          
          if (hasChanged) {
            console.log(`[UserMasterAPI] Field ${dbField} changed: "${currentValue || '(null)'}" -> "${newStr}"`);
          } else {
            console.log(`[UserMasterAPI] Field ${dbField} unchanged: "${currentValue || '(null)'}"`);
          }
        }
      }
      
      if (hasChanged) {
        updateFields.push(`${dbField} = $${paramIndex}`);
        updateValues.push(valueToStore);
        paramIndex++;
      }
    }

    // If no fields need updating, skip the update
    if (updateFields.length === 0) {
      console.log(`[UserMasterAPI] No changes detected for employee ${existingEmployee.emp_code || existingEmployee.id}, skipping update`);
      return true; // Still return true as sync was attempted
    }

    // Store the field values separately (these will be parameters $1, $2, etc.)
    const fieldValues = [...updateValues]; // Copy the current values
    
    // Add updated_at (no parameter needed)
    updateFields.push(`updated_at = NOW()`);
    
    // Now rebuild the SET clause with correct parameter numbers
    // We need to renumber parameters starting from 1
    const rebuiltFields = [];
    let newParamIndex = 1;
    
    for (const field of updateFields) {
      if (field.includes('$')) {
        // Replace parameter number with the correct sequential number
        rebuiltFields.push(field.replace(/\$\d+/, `$${newParamIndex}`));
        newParamIndex++;
      } else {
        // Non-parameterized field (like updated_at = NOW())
        rebuiltFields.push(field);
      }
    }
    
    // Add employee ID as the last parameter for WHERE clause
    fieldValues.push(existingEmployee.id);
    const whereParamIndex = newParamIndex;

    // Build the update query with correctly numbered parameters
    const updateQuery = `
      UPDATE employees 
      SET ${rebuiltFields.join(', ')}
      WHERE id = $${whereParamIndex}
    `;

    console.log(`[UserMasterAPI] Update query:`, updateQuery);
    console.log(`[UserMasterAPI] Update values (${fieldValues.length} params):`, fieldValues);
    console.log(`[UserMasterAPI] Parameter count check: query expects ${whereParamIndex} params, values array has ${fieldValues.length}`);

    // Verify parameter count matches
    if (fieldValues.length !== whereParamIndex) {
      console.error(`[UserMasterAPI] CRITICAL: Parameter count mismatch!`);
      console.error(`[UserMasterAPI] Query expects ${whereParamIndex} parameters but values array has ${fieldValues.length}`);
      console.error(`[UserMasterAPI] Rebuilt fields:`, rebuiltFields);
      console.error(`[UserMasterAPI] Field values:`, fieldValues);
      throw new Error(`Parameter count mismatch: query expects ${whereParamIndex} but got ${fieldValues.length} values`);
    }

    const updateResult = await query(updateQuery, fieldValues);
    console.log(`[UserMasterAPI] Update result - rows affected:`, updateResult.rowCount);

    // Verify the update by fetching the updated record
    const verifyResult = await query(
      'SELECT department, sub_department, manager_code, location, date_of_joining FROM employees WHERE id = $1',
      [existingEmployee.id]
    );
    
    if (verifyResult.rows.length > 0) {
      console.log(`[UserMasterAPI] Verified updated record:`, verifyResult.rows[0]);
    }

    console.log(`[UserMasterAPI] Successfully synced employee data for ${finalEmployeeCode}. Updated fields: ${updateFields.filter(f => !f.includes('updated_at')).map(f => f.split('=')[0].trim()).join(', ')}`);
    
    return true;
  } catch (error) {
    console.error(`[UserMasterAPI] Error syncing employee data for ${employeeCode || email}:`, error);
    console.error(`[UserMasterAPI] Error stack:`, error.stack);
    // Don't throw - allow login to proceed even if sync fails
    return false;
  }
};

export const shouldRefreshEmployeeData = (existingEmployee) => {
  return shouldSyncEmployeeData(existingEmployee);
};

export default {
  fetchEmployeeFromUserMaster,
  fetchEmployeeFromUserMasterByEmail,
  shouldRefreshEmployeeData,
  shouldSyncEmployeeData,
  syncEmployeeDataFromUserMaster
};
