import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service
 * Handles sending emails using SMTP configuration from environment variables
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  /**
   * Initialize SMTP transporter
   */
  initializeTransporter() {
    try {
      const smtpConfig = {
        host: process.env.SMTP_HOST || 'outlook.office365.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      };

      this.transporter = nodemailer.createTransport(smtpConfig);

      // Verify connection
      this.transporter.verify((error, success) => {
        if (error) {
          console.error('[EmailService] SMTP connection error:', error);
        } else {
          console.log('[EmailService] SMTP server is ready to send emails');
        }
      });
    } catch (error) {
      console.error('[EmailService] Failed to initialize transporter:', error);
    }
  }

  /**
   * Send email
   * @param {Object} options - Email options
   * @param {string|string[]} options.to - Recipient email(s)
   * @param {string} options.subject - Email subject
   * @param {string} options.text - Plain text content
   * @param {string} options.html - HTML content (optional)
   * @returns {Promise<Object>} - Send result
   */
  async sendEmail({ to, subject, text, html }) {
    if (!this.transporter) {
      throw new Error('Email transporter not initialized');
    }

    if (!to || !subject || !text) {
      throw new Error('Missing required email fields: to, subject, text');
    }

    const fromEmail = process.env.FROM_EMAIL || 'noc1@utthunga.com';
    const fromName = process.env.FROM_NAME || 'Utthunga Technologies';

    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html: html || text, // Use HTML if provided, otherwise use text
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`[EmailService] Email sent successfully to ${to}:`, info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error(`[EmailService] Failed to send email to ${to}:`, error);
      throw error;
    }
  }

  /**
   * Send bulk emails (with error handling per recipient)
   * @param {Array} emailList - Array of email options
   * @returns {Promise<Object>} - Results with success and failure counts
   */
  async sendBulkEmails(emailList) {
    const results = {
      total: emailList.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    for (const emailOptions of emailList) {
      try {
        await this.sendEmail(emailOptions);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          to: emailOptions.to,
          error: error.message,
        });
        console.error(`[EmailService] Failed to send email to ${emailOptions.to}:`, error.message);
      }
    }

    return results;
  }
}

// Export singleton instance
export default new EmailService();
