import { query } from '../config/database.js';
import emailService from './emailService.js';

/**
 * Reminder Service
 * Handles logic for determining which reminders to send and sending them
 */
class ReminderService {
  /**
   * Format date to YYYY-MM-DD string
   * @param {Date|string} date - Date to format
   * @returns {string} - Formatted date string
   */
  formatDate(date) {
    if (!date) return null;
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Calculate days between two dates
   * @param {Date|string} date1 - First date
   * @param {Date|string} date2 - Second date
   * @returns {number} - Days difference
   */
  daysBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    d1.setHours(0, 0, 0, 0);
    d2.setHours(0, 0, 0, 0);
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  }

  /**
   * Check if reminder was already sent
   * @param {string} employeeId - Employee ID
   * @param {string} reminderType - Type of reminder
   * @param {string} reminderDate - Date reminder was sent
   * @param {string} targetDate - Target milestone date
   * @param {number} quarter - Quarter number
   * @param {number|null} daysBefore - Days before target date
   * @returns {Promise<boolean>} - True if already sent
   */
  async isReminderAlreadySent(employeeId, reminderType, reminderDate, targetDate, quarter, daysBefore) {
    try {
      // Use IS NOT DISTINCT FROM to handle NULL comparisons properly in PostgreSQL
      // This operator treats NULL = NULL as true, unlike regular =
      const result = await query(
        `SELECT id FROM email_reminders 
         WHERE employee_id = $1 
           AND reminder_type = $2 
           AND reminder_date = $3 
           AND target_date = $4 
           AND quarter IS NOT DISTINCT FROM $5
           AND days_before IS NOT DISTINCT FROM $6`,
        [employeeId, reminderType, reminderDate, targetDate, quarter, daysBefore]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('[ReminderService] Error checking reminder status:', error);
      return false; // On error, assume not sent to avoid blocking
    }
  }

  /**
   * Record reminder as sent
   * @param {Object} reminderData - Reminder data
   * @returns {Promise<void>}
   */
  async recordReminderSent(reminderData) {
    try {
      // Insert the reminder - the unique index will prevent duplicates
      // If duplicate, PostgreSQL will throw error code 23505
      await query(
        `INSERT INTO email_reminders 
         (employee_id, reminder_type, reminder_date, target_date, quarter, cycle_id, days_before)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          reminderData.employeeId,
          reminderData.reminderType,
          reminderData.reminderDate,
          reminderData.targetDate,
          reminderData.quarter || null,
          reminderData.cycleId || null,
          reminderData.daysBefore !== undefined ? reminderData.daysBefore : null,
        ]
      );
    } catch (error) {
      // If it's a unique constraint violation, that's expected (duplicate) - just log and continue
      if (error.code === '23505' || error.message?.includes('duplicate key')) {
        // Duplicate reminder - this is expected and not an error
        // Silently continue as this means the reminder was already sent
      } else {
        console.error('[ReminderService] Error recording reminder:', error);
        // Don't throw - logging is sufficient to avoid blocking the process
      }
    }
  }

  /**
   * Get all active employees
   * @returns {Promise<Array>} - Array of active employees
   */
  async getActiveEmployees() {
    try {
      const result = await query(
        `SELECT id, email, full_name, emp_code 
         FROM employees 
         WHERE status = 'active' 
           AND email IS NOT NULL 
           AND email != '' 
         ORDER BY email`,
        []
      );
      return result.rows;
    } catch (error) {
      console.error('[ReminderService] Error fetching active employees:', error);
      return [];
    }
  }

  /**
   * Get active cycle data (similar to /api/cycles/active)
   * @returns {Promise<Object|null>} - Active cycle data or null
   */
  async getActiveCycleData() {
    try {
      // Get active cycle
      const cycleResult = await query(
        "SELECT * FROM performance_cycles WHERE status = 'active' ORDER BY created_at DESC LIMIT 1",
        []
      );
      const cycle = cycleResult.rows[0] || null;

      if (!cycle) {
        return null;
      }

      // Get quarterly cycles
      const quarterlyCyclesResult = await query(
        `SELECT id, performance_cycle_id, quarter, quarter_start_date, quarter_end_date,
                self_review_start_date, self_review_end_date,
                manager_review_start_date as quarterly_manager_review_start_date, 
                manager_review_end_date as quarterly_manager_review_end_date, status
         FROM quarterly_cycles
         WHERE performance_cycle_id = $1
         ORDER BY quarter`,
        [cycle.id]
      );

      // Get goals quarterly cycles
      const goalsQuarterlyCyclesResult = await query(
        `SELECT gqc.id, gqc.performance_cycle_id, gqc.quarter,
                qc.id as quarterly_cycle_id,
                qc.quarter_start_date as quarterly_start_date,
                qc.quarter_end_date as quarterly_end_date,
                gqc.goal_submission_start_date, gqc.goal_submission_end_date,
                gqc.manager_review_start_date as goals_manager_review_start_date, 
                gqc.manager_review_end_date as goals_manager_review_end_date,
                gqc.allow_late_goal_submission, gqc.status,
                gqc.created_at, gqc.updated_at
         FROM goals_quarterly_cycles gqc
         LEFT JOIN quarterly_cycles qc ON qc.performance_cycle_id = gqc.performance_cycle_id AND qc.quarter = gqc.quarter
         WHERE gqc.performance_cycle_id = $1
         ORDER BY gqc.quarter`,
        [cycle.id]
      );

      return {
        cycle,
        quarterly_cycles: quarterlyCyclesResult.rows,
        goals_quarterly_cycles: goalsQuarterlyCyclesResult.rows,
      };
    } catch (error) {
      console.error('[ReminderService] Error fetching active cycle data:', error);
      return null;
    }
  }


  getEmailContent(reminderType, targetDate) {
    const formattedDate = this.formatDate(targetDate);
    const dateStr = formattedDate ? new Date(targetDate).toLocaleDateString('en-GB', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    }) : targetDate;

    const templates = {
      goal_submission: {
        subject: 'Reminder: Submit Your Goals',
        text: `Hello,\n\nPlease submit your goals before ${dateStr}.\n\nRegards,\nUtthunga Technologies`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <p>Hello,</p>
            <p>Please submit your goals before <strong>${dateStr}</strong>.</p>
            <p>Regards,<br>Utthunga Technologies</p>
          </div>
        `.trim(),
      },
      goals_manager_review: {
        subject: 'Reminder: Review Your Reportees\' Goals',
        text: `Hello,\n\nPlease review your reportees' goals before ${dateStr}.\n\nRegards,\nUtthunga Technologies`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <p>Hello,</p>
            <p>Please review your reportees' goals before <strong>${dateStr}</strong>.</p>
            <p>Regards,<br>Utthunga Technologies</p>
          </div>
        `.trim(),
      },
      self_review: {
        subject: 'Reminder: Complete Your Performance Self-Evaluation',
        text: `Hello,\n\nPlease complete your performance self-evaluation before ${dateStr}.\n\nRegards,\nUtthunga Technologies`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <p>Hello,</p>
            <p>Please complete your performance self-evaluation before <strong>${dateStr}</strong>.</p>
            <p>Regards,<br>Utthunga Technologies</p>
          </div>
        `.trim(),
      },
      manager_review: {
        subject: 'Reminder: Complete Performance Reviews for Your Reportees',
        text: `Hello,\n\nPlease complete the performance reviews for your reportees before ${dateStr}.\n\nRegards,\nUtthunga Technologies`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <p>Hello,</p>
            <p>Please complete the performance reviews for your reportees before <strong>${dateStr}</strong>.</p>
            <p>Regards,<br>Utthunga Technologies</p>
          </div>
        `.trim(),
      },
    };

    return templates[reminderType] || {
      subject: 'PMS Reminder',
      text: `Hello,\n\nThis is a reminder for an important PMS milestone.\n\nRegards,\nUtthunga Technologies`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <p>Hello,</p>
          <p>This is a reminder for an important PMS milestone.</p>
          <p>Regards,<br>Utthunga Technologies</p>
        </div>
      `.trim(),
    };
  }

  /**
   * Check if today matches a reminder trigger date
   * @param {Date|string} targetDate - Target milestone date
   * @param {boolean} isEndDate - Whether this is an end date (needs 3,2,1,0 day reminders)
   * @param {Date} today - Today's date
   * @returns {Object|null} - { daysBefore: number } or null if no reminder needed
   */
  shouldSendReminder(targetDate, isEndDate, today = new Date()) {
    if (!targetDate) return null;

    const target = new Date(targetDate);
    const todayDate = new Date(today);
    target.setHours(0, 0, 0, 0);
    todayDate.setHours(0, 0, 0, 0);

    const daysDiff = this.daysBetween(todayDate, target);

    if (isEndDate) {
      // End dates: send 3, 2, 1 days before and on the date
      if (daysDiff === 3 || daysDiff === 2 || daysDiff === 1 || daysDiff === 0) {
        return { daysBefore: daysDiff };
      }
    } else {
      // Start dates: send on the date itself and optionally 1 day before
      if (daysDiff === 0) {
        return { daysBefore: null }; // Start date reminder
      } else if (daysDiff === 1) {
        return { daysBefore: 1 }; // 1 day before start date (optional)
      }
    }

    return null;
  }

  /**
   * Process reminders for a specific reminder type and date
   * @param {string} reminderType - Type of reminder
   * @param {string} targetDate - Target milestone date
   * @param {number} quarter - Quarter number
   * @param {string} cycleId - Cycle ID
   * @param {number|null} daysBefore - Days before target date
   * @param {Array} employees - List of employees to send to
   * @returns {Promise<Object>} - Results
   */
  async processReminders(reminderType, targetDate, quarter, cycleId, daysBefore, employees) {
    const results = {
      total: employees.length,
      sent: 0,
      skipped: 0,
      errors: 0,
    };

    if (!targetDate) {
      console.log(`[ReminderService] Skipping ${reminderType} - no target date`);
      return results;
    }

    const today = this.formatDate(new Date());
    const emailContent = this.getEmailContent(reminderType, targetDate);

    for (const employee of employees) {
      try {
        // Check if already sent
        const alreadySent = await this.isReminderAlreadySent(
          employee.id,
          reminderType,
          today,
          this.formatDate(targetDate),
          quarter,
          daysBefore
        );

        if (alreadySent) {
          console.log(`[ReminderService] Skipping ${reminderType} reminder for ${employee.email} - already sent`);
          results.skipped++;
          continue;
        }

        // Send email
        await emailService.sendEmail({
          to: employee.email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        });

        // Record as sent
        await this.recordReminderSent({
          employeeId: employee.id,
          reminderType,
          reminderDate: today,
          targetDate: this.formatDate(targetDate),
          quarter,
          cycleId,
          daysBefore,
        });

        console.log(`[ReminderService] Sent ${reminderType} reminder to ${employee.email} (${daysBefore !== null ? `${daysBefore} days before` : 'on date'})`);
        results.sent++;
      } catch (error) {
        console.error(`[ReminderService] Error sending ${reminderType} reminder to ${employee.email}:`, error.message);
        results.errors++;
      }
    }

    return results;
  }

  /**
   * Process all reminders for the current day
   * @returns {Promise<Object>} - Summary of all reminders processed
   */
  async processAllReminders() {
    console.log('[ReminderService] Starting daily reminder processing...');
    const summary = {
      timestamp: new Date().toISOString(),
      cycleFound: false,
      employeesFound: 0,
      remindersProcessed: 0,
      emailsSent: 0,
      emailsSkipped: 0,
      errors: 0,
      details: [],
    };

    try {
      // Get active cycle data
      const cycleData = await this.getActiveCycleData();
      if (!cycleData) {
        console.log('[ReminderService] No active cycle found - skipping reminders');
        return summary;
      }

      summary.cycleFound = true;
      summary.cycleId = cycleData.cycle.id;

      // Get active employees
      const employees = await this.getActiveEmployees();
      if (employees.length === 0) {
        console.log('[ReminderService] No active employees found - skipping reminders');
        return summary;
      }

      summary.employeesFound = employees.length;
      const today = new Date();

      // Process Goals Quarterly Cycles reminders
      for (const gqc of cycleData.goals_quarterly_cycles) {
        const quarter = gqc.quarter;
        const cycleId = cycleData.cycle.id;

        // Goal Submission (Employee) - goal_submission_start_date and goal_submission_end_date
        if (gqc.goal_submission_start_date) {
          const startReminder = this.shouldSendReminder(gqc.goal_submission_start_date, false, today);
          if (startReminder) {
            const result = await this.processReminders(
              'goal_submission',
              gqc.goal_submission_start_date,
              quarter,
              cycleId,
              startReminder.daysBefore,
              employees
            );
            summary.remindersProcessed++;
            summary.emailsSent += result.sent;
            summary.emailsSkipped += result.skipped;
            summary.errors += result.errors;
            summary.details.push({
              type: 'goal_submission',
              quarter,
              date: gqc.goal_submission_start_date,
              daysBefore: startReminder.daysBefore,
              ...result,
            });
          }
        }

        if (gqc.goal_submission_end_date) {
          const endReminder = this.shouldSendReminder(gqc.goal_submission_end_date, true, today);
          if (endReminder) {
            const result = await this.processReminders(
              'goal_submission',
              gqc.goal_submission_end_date,
              quarter,
              cycleId,
              endReminder.daysBefore,
              employees
            );
            summary.remindersProcessed++;
            summary.emailsSent += result.sent;
            summary.emailsSkipped += result.skipped;
            summary.errors += result.errors;
            summary.details.push({
              type: 'goal_submission',
              quarter,
              date: gqc.goal_submission_end_date,
              daysBefore: endReminder.daysBefore,
              ...result,
            });
          }
        }

        // Goals Manager Review - goals_manager_review_start_date and goals_manager_review_end_date
        if (gqc.goals_manager_review_start_date) {
          const startReminder = this.shouldSendReminder(gqc.goals_manager_review_start_date, false, today);
          if (startReminder) {
            const result = await this.processReminders(
              'goals_manager_review',
              gqc.goals_manager_review_start_date,
              quarter,
              cycleId,
              startReminder.daysBefore,
              employees
            );
            summary.remindersProcessed++;
            summary.emailsSent += result.sent;
            summary.emailsSkipped += result.skipped;
            summary.errors += result.errors;
            summary.details.push({
              type: 'goals_manager_review',
              quarter,
              date: gqc.goals_manager_review_start_date,
              daysBefore: startReminder.daysBefore,
              ...result,
            });
          }
        }

        if (gqc.goals_manager_review_end_date) {
          const endReminder = this.shouldSendReminder(gqc.goals_manager_review_end_date, true, today);
          if (endReminder) {
            const result = await this.processReminders(
              'goals_manager_review',
              gqc.goals_manager_review_end_date,
              quarter,
              cycleId,
              endReminder.daysBefore,
              employees
            );
            summary.remindersProcessed++;
            summary.emailsSent += result.sent;
            summary.emailsSkipped += result.skipped;
            summary.errors += result.errors;
            summary.details.push({
              type: 'goals_manager_review',
              quarter,
              date: gqc.goals_manager_review_end_date,
              daysBefore: endReminder.daysBefore,
              ...result,
            });
          }
        }
      }

      // Process Quarterly Cycles reminders
      for (const qc of cycleData.quarterly_cycles) {
        const quarter = qc.quarter;
        const cycleId = cycleData.cycle.id;

        // Self-Evaluation (Employee) - self_review_start_date and self_review_end_date
        if (qc.self_review_start_date) {
          const startReminder = this.shouldSendReminder(qc.self_review_start_date, false, today);
          if (startReminder) {
            const result = await this.processReminders(
              'self_review',
              qc.self_review_start_date,
              quarter,
              cycleId,
              startReminder.daysBefore,
              employees
            );
            summary.remindersProcessed++;
            summary.emailsSent += result.sent;
            summary.emailsSkipped += result.skipped;
            summary.errors += result.errors;
            summary.details.push({
              type: 'self_review',
              quarter,
              date: qc.self_review_start_date,
              daysBefore: startReminder.daysBefore,
              ...result,
            });
          }
        }

        if (qc.self_review_end_date) {
          const endReminder = this.shouldSendReminder(qc.self_review_end_date, true, today);
          if (endReminder) {
            const result = await this.processReminders(
              'self_review',
              qc.self_review_end_date,
              quarter,
              cycleId,
              endReminder.daysBefore,
              employees
            );
            summary.remindersProcessed++;
            summary.emailsSent += result.sent;
            summary.emailsSkipped += result.skipped;
            summary.errors += result.errors;
            summary.details.push({
              type: 'self_review',
              quarter,
              date: qc.self_review_end_date,
              daysBefore: endReminder.daysBefore,
              ...result,
            });
          }
        }

        // Manager Performance Review - quarterly_manager_review_start_date and quarterly_manager_review_end_date
        if (qc.quarterly_manager_review_start_date) {
          const startReminder = this.shouldSendReminder(qc.quarterly_manager_review_start_date, false, today);
          if (startReminder) {
            const result = await this.processReminders(
              'manager_review',
              qc.quarterly_manager_review_start_date,
              quarter,
              cycleId,
              startReminder.daysBefore,
              employees
            );
            summary.remindersProcessed++;
            summary.emailsSent += result.sent;
            summary.emailsSkipped += result.skipped;
            summary.errors += result.errors;
            summary.details.push({
              type: 'manager_review',
              quarter,
              date: qc.quarterly_manager_review_start_date,
              daysBefore: startReminder.daysBefore,
              ...result,
            });
          }
        }

        if (qc.quarterly_manager_review_end_date) {
          const endReminder = this.shouldSendReminder(qc.quarterly_manager_review_end_date, true, today);
          if (endReminder) {
            const result = await this.processReminders(
              'manager_review',
              qc.quarterly_manager_review_end_date,
              quarter,
              cycleId,
              endReminder.daysBefore,
              employees
            );
            summary.remindersProcessed++;
            summary.emailsSent += result.sent;
            summary.emailsSkipped += result.skipped;
            summary.errors += result.errors;
            summary.details.push({
              type: 'manager_review',
              quarter,
              date: qc.quarterly_manager_review_end_date,
              daysBefore: endReminder.daysBefore,
              ...result,
            });
          }
        }
      }

      console.log('[ReminderService] Daily reminder processing completed:', {
        remindersProcessed: summary.remindersProcessed,
        emailsSent: summary.emailsSent,
        emailsSkipped: summary.emailsSkipped,
        errors: summary.errors,
      });
    } catch (error) {
      console.error('[ReminderService] Error processing reminders:', error);
      summary.errors++;
      summary.errorMessage = error.message;
    }

    return summary;
  }
}

// Export singleton instance
export default new ReminderService();
