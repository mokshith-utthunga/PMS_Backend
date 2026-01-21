import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Get notifications for current user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.query.user_id || req.user.userId;
    
    const result = await query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// Get unread count
router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await query(
      `SELECT COUNT(*) as count FROM notifications 
       WHERE user_id = $1 AND is_read = false`,
      [userId]
    );

    res.json({ count: parseInt(result.rows[0]?.count || 0) });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Mark notification as read
router.put('/:id/read', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      `UPDATE notifications 
       SET is_read = true 
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
router.put('/read-all', authMiddleware, async (req, res) => {
  try {
    await query(
      `UPDATE notifications 
       SET is_read = true 
       WHERE user_id = $1 AND is_read = false`,
      [req.user.userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// Alias: Mark all notifications as read (for frontend compatibility)
router.put('/mark-all-read', authMiddleware, async (req, res) => {
  try {
    await query(
      `UPDATE notifications 
       SET is_read = true 
       WHERE user_id = $1 AND is_read = false`,
      [req.user.userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// Create notification (internal use)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { user_id, type, title, message, link } = req.body;

    const result = await query(
      `INSERT INTO notifications (user_id, type, title, message, link)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user_id, type || 'general', title, message, link]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// Delete notification
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    await query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
      [id, req.user.userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

export default router;
