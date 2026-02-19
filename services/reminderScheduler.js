import cron from 'node-cron';
import reminderService from './reminderService.js';

/**
 * Reminder Scheduler
 * Manages cron job for daily email reminders
 */
class ReminderScheduler {
  constructor() {
    this.job = null;
    this.isRunning = false;
  }

  /**
   * Start the daily reminder cron job
   * Runs once per day at 9:00 AM (configurable via env)
   */
  start() {
    // Default to 9:00 AM, can be configured via REMINDER_CRON_SCHEDULE env var
    // Format: "0 9 * * *" (minute hour day month weekday)
    const schedule = process.env.REMINDER_CRON_SCHEDULE || '0 9 * * *';
    
    if (this.job) {
      console.log('[ReminderScheduler] Cron job already running');
      return;
    }

    console.log(`[ReminderScheduler] Starting daily reminder cron job with schedule: ${schedule}`);

    this.job = cron.schedule(schedule, async () => {
      if (this.isRunning) {
        console.log('[ReminderScheduler] Previous reminder job still running, skipping this execution');
        return;
      }

      this.isRunning = true;
      const startTime = Date.now();

      try {
        console.log('[ReminderScheduler] Executing daily reminder job...');
        const summary = await reminderService.processAllReminders();
        
        const duration = Date.now() - startTime;
        console.log(`[ReminderScheduler] Reminder job completed in ${duration}ms:`, {
          cycleFound: summary.cycleFound,
          employeesFound: summary.employeesFound,
          remindersProcessed: summary.remindersProcessed,
          emailsSent: summary.emailsSent,
          emailsSkipped: summary.emailsSkipped,
          errors: summary.errors,
        });
      } catch (error) {
        console.error('[ReminderScheduler] Error in reminder job:', error);
      } finally {
        this.isRunning = false;
      }
    }, {
      scheduled: true,
      timezone: process.env.TZ || 'Asia/Kolkata', // Default to IST, can be configured
    });

    console.log('[ReminderScheduler] Daily reminder cron job started successfully');
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.job) {
      this.job.stop();
      this.job = null;
      console.log('[ReminderScheduler] Cron job stopped');
    }
  }

  /**
   * Manually trigger reminder processing (for testing/admin)
   * @returns {Promise<Object>} - Processing summary
   */
  async triggerManually() {
    if (this.isRunning) {
      throw new Error('Reminder job is already running');
    }

    this.isRunning = true;
    try {
      console.log('[ReminderScheduler] Manually triggering reminder processing...');
      const summary = await reminderService.processAllReminders();
      return summary;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get scheduler status
   * @returns {Object} - Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isScheduled: this.job !== null,
      schedule: process.env.REMINDER_CRON_SCHEDULE || '0 9 * * *',
      timezone: process.env.TZ || 'Asia/Kolkata',
    };
  }
}

// Export singleton instance
export default new ReminderScheduler();
