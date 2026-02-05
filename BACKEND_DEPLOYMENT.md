# Backend Deployment Guide

## 📋 Overview

The backend is a **Node.js/Express** application written in **JavaScript (ES Modules)**. Unlike the frontend, there's **no build step** required - you just need to install dependencies and run the server.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd server
npm install
```

For production (faster, smaller):
```bash
npm install --production
```

### 2. Set Up Environment Variables

Create a `.env` file in the `server` directory:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pms_db
DB_USER=postgres
DB_PASSWORD=your_password_here

# Server Configuration
PORT=3001
NODE_ENV=production

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-key-change-in-production
JWT_EXPIRES_IN=7d

# Frontend URL (for CORS and redirects)
FRONTEND_URL=https://your-frontend-domain.com

# CORS Origins (comma-separated)
CORS_ORIGINS=https://your-frontend-domain.com

# External API (optional)
USER_MASTER_API=https://people.utthunga.io/api/user-master/search
```

### 3. Set Up Database

```bash
# Create database
psql -U postgres -c "CREATE DATABASE pms_db;"

# Run schema
psql -U postgres -d pms_db -f db/schema.sql

# (Optional) Seed initial data
psql -U postgres -d pms_db -f db/seed.sql
```

### 4. Run Database Migrations

```bash
npm run migrate
```

This runs all migrations in `db/migrations/` directory.

### 5. Start the Server

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

## 🏭 Production Deployment

### Option 1: Direct Node.js (Simple)

```bash
cd server
npm install --production
npm start
```

### Option 2: PM2 (Recommended for Production)

**Install PM2:**
```bash
npm install -g pm2
```

**Create PM2 ecosystem file** (`ecosystem.config.js`):
```javascript
export default {
  apps: [{
    name: 'pms-backend',
    script: './index.js',
    instances: 2, // Number of CPU cores
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G'
  }]
};
```

**Start with PM2:**
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Set up PM2 to start on system boot
```

**PM2 Commands:**
```bash
pm2 list              # List all processes
pm2 logs pms-backend  # View logs
pm2 restart pms-backend  # Restart
pm2 stop pms-backend     # Stop
pm2 delete pms-backend   # Remove
```

### Option 3: Docker (Optional)

**Create `Dockerfile`:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Expose port
EXPOSE 3001

# Start server
CMD ["node", "index.js"]
```

**Create `docker-compose.yml`:**
```yaml
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres
      - DB_NAME=pms_db
      - DB_USER=postgres
      - DB_PASSWORD=your_password
      - JWT_SECRET=your-secret
      - FRONTEND_URL=http://localhost:8080
    depends_on:
      - postgres
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=pms_db
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=your_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

volumes:
  postgres_data:
```

**Run with Docker:**
```bash
docker-compose up -d
```

## 📝 Available Scripts

```bash
# Start production server
npm start

# Start development server (with auto-reload)
npm run dev

# Run all database migrations
npm run migrate

# Run specific migration
npm run migrate:001
npm run migrate:002
npm run migrate:hr-review
```

## 🔧 Production Checklist

### Before Deployment:
- [ ] Environment variables configured in `.env`
- [ ] Database created and accessible
- [ ] Database schema applied (`db/schema.sql`)
- [ ] Migrations run (`npm run migrate`)
- [ ] Dependencies installed (`npm install --production`)
- [ ] JWT_SECRET is strong and unique
- [ ] CORS_ORIGINS includes frontend domain
- [ ] FRONTEND_URL matches actual frontend URL

### Server Configuration:
- [ ] Node.js version 18+ installed
- [ ] PostgreSQL 12+ installed and running
- [ ] Port 3001 (or configured port) is available
- [ ] Firewall allows traffic on server port
- [ ] Process manager configured (PM2 recommended)

### Security:
- [ ] HTTPS enabled (use reverse proxy like Nginx)
- [ ] JWT_SECRET is secure (not default)
- [ ] Database credentials are secure
- [ ] CORS restricted to known origins
- [ ] Environment variables not exposed

## 🌐 Reverse Proxy Setup (Nginx)

**Example Nginx configuration** (`/etc/nginx/sites-available/pms-backend`):

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # SSL Configuration
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;

    # Proxy to Node.js backend
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:3001/health;
        access_log off;
    }
}
```

**Enable and restart:**
```bash
sudo ln -s /etc/nginx/sites-available/pms-backend /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
```

## 🔍 Verification

### Check Server is Running:
```bash
# Check if process is running
ps aux | grep node

# Or with PM2
pm2 list

# Check if port is listening
netstat -tulpn | grep 3001
# Or
lsof -i :3001
```

### Test Health Endpoint:
```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Test API Endpoint:
```bash
curl http://localhost:3001/api/auth/session
```

## 📊 Monitoring

### PM2 Monitoring:
```bash
pm2 monit  # Real-time monitoring
pm2 logs   # View all logs
```

### Log Files:
- Application logs: Check PM2 logs or console output
- Error logs: Check `logs/err.log` (if configured)
- Access logs: Configure in Nginx or add middleware

## 🐛 Troubleshooting

### Server Won't Start:
1. Check Node.js version: `node --version` (should be 18+)
2. Check port availability: `lsof -i :3001`
3. Check environment variables: `cat .env`
4. Check database connection
5. Check logs: `pm2 logs` or console output

### Database Connection Errors:
1. Verify PostgreSQL is running: `pg_isready`
2. Check database credentials in `.env`
3. Check network connectivity
4. Verify database exists: `psql -U postgres -l`

### CORS Errors:
1. Check `CORS_ORIGINS` includes frontend URL
2. Check `FRONTEND_URL` matches actual domain
3. Verify CORS middleware is configured
4. Check browser console for specific error

## 📦 File Structure

```
server/
├── index.js              # Main entry point
├── package.json          # Dependencies and scripts
├── .env                  # Environment variables (create this)
├── config/
│   └── database.js       # Database configuration
├── middleware/
│   └── auth.js           # Authentication middleware
├── routes/               # API route handlers
├── services/             # Business logic
├── db/
│   ├── schema.sql        # Database schema
│   ├── seed.sql          # Seed data
│   └── migrations/       # Database migrations
└── scripts/              # Utility scripts
```

## ✅ Summary

**Backend deployment is simple:**
1. ✅ Install dependencies: `npm install --production`
2. ✅ Configure `.env` file
3. ✅ Set up database
4. ✅ Run migrations: `npm run migrate`
5. ✅ Start server: `npm start` or `pm2 start`

**No build step needed** - it's JavaScript, Node.js runs it directly!

The backend is ready to deploy. Just ensure environment variables are configured correctly and the database is set up.
