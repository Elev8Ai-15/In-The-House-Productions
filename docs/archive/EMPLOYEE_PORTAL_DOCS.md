# 👥 EMPLOYEE PORTAL SYSTEM

## 📅 Date: January 13, 2026

## ✅ System Overview

A comprehensive employee management system that allows DJs and Photobooth operators to:
- Login with their credentials
- View their upcoming bookings
- Block/unblock dates on their calendar
- View their change history (audit trail)
- Manage their own availability

**All changes are logged for admin review.**

---

## 🔐 Employee Accounts Created

### Default Password for All Employees: `Employee123!`

| Employee | Provider ID | Email | Service Type |
|----------|-------------|-------|--------------|
| Mike Cecil (DJ Cease) | `dj_cease` | mike@inthehouseproductions.com | DJ |
| Brad Powell (DJ Elev8) | `dj_elev8` | brad@inthehouseproductions.com | DJ |
| Joey Tate (TKOtheDJ) | `tko_the_dj` | joey@inthehouseproductions.com | DJ |
| Maria Cecil (Photobooth Unit 1) | `photobooth_unit1` | maria@inthehouseproductions.com | Photobooth |
| Cora Scarborough (Photobooth Unit 2) | `photobooth_unit2` | cora@inthehouseproductions.com | Photobooth |

---

## 🌐 Access URLs

### Production
- **Employee Login**: https://www.inthehouseproductions.com/employee/login
- **Employee Dashboard**: https://www.inthehouseproductions.com/employee/dashboard

### Latest Deployment
- https://1da65e25.webapp-2mf.pages.dev/employee/login

---

## 📊 Database Schema

### New Tables Created

#### 1. `employees` Table
```sql
CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  provider_id TEXT NOT NULL,        -- 'dj_cease', 'photobooth_unit1', etc.
  service_type TEXT NOT NULL,       -- 'dj' or 'photobooth'
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 2. `change_logs` Table (Audit Trail)
```sql
CREATE TABLE change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  action_type TEXT NOT NULL,        -- 'block_date', 'unblock_date', 'login', 'logout'
  target_date DATE,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
```

#### 3. Updated `availability_blocks` Table
```sql
ALTER TABLE availability_blocks ADD COLUMN employee_id INTEGER;
ALTER TABLE availability_blocks ADD COLUMN updated_at DATETIME;
```

---

## 🔌 API Endpoints

### Authentication

#### `POST /api/employee/login`
Login with employee credentials
```json
{
  "email": "mike@inthehouseproductions.com",
  "password": "Employee123!"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "employee": {
    "id": 1,
    "full_name": "Mike Cecil",
    "email": "mike@inthehouseproductions.com",
    "provider_id": "dj_cease",
    "service_type": "dj"
  }
}
```

#### `POST /api/employee/logout`
Log out (records logout in audit trail)
- Requires: `Authorization: Bearer {token}`

#### `GET /api/employee/me`
Get current employee info
- Requires: `Authorization: Bearer {token}`

---

### Calendar Management

#### `GET /api/employee/blocked-dates`
Get all blocked dates for this employee's provider
- Requires: `Authorization: Bearer {token}`

**Response:**
```json
{
  "success": true,
  "blocked_dates": [
    {
      "id": 1,
      "service_provider": "dj_cease",
      "block_date": "2026-02-15",
      "reason": "Personal vacation",
      "created_at": "2026-01-13T10:00:00Z"
    }
  ]
}
```

#### `POST /api/employee/block-date`
Block a date on your calendar
- Requires: `Authorization: Bearer {token}`

```json
{
  "date": "2026-02-15",
  "reason": "Personal vacation"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Date blocked successfully",
  "block_id": 42
}
```

**Audit Trail**: Logs action as `block_date` with date, reason, and IP address

#### `DELETE /api/employee/unblock-date/:blockId`
Remove a date block
- Requires: `Authorization: Bearer {token}`

**Audit Trail**: Logs action as `unblock_date` with original reason and IP address

---

### Bookings (Read-Only)

#### `GET /api/employee/bookings`
View all bookings for this employee's provider
- Requires: `Authorization: Bearer {token}`

**Response:**
```json
{
  "success": true,
  "bookings": [
    {
      "id": 1,
      "event_date": "2026-03-20",
      "event_start_time": "18:00",
      "event_end_time": "23:00",
      "status": "confirmed",
      "event_name": "Smith Wedding",
      "event_type": "wedding",
      "city": "Lexington",
      "state": "KY"
    }
  ]
}
```

---

### Audit Trail

#### `GET /api/employee/change-log`
View your change history
- Requires: `Authorization: Bearer {token}`
- Query Params: `limit` (default 50), `offset` (default 0)

**Response:**
```json
{
  "success": true,
  "logs": [
    {
      "id": 1,
      "action_type": "block_date",
      "target_date": "2026-02-15",
      "new_value": "blocked",
      "reason": "Personal vacation",
      "ip_address": "192.168.1.1",
      "created_at": "2026-01-13T10:00:00Z"
    },
    {
      "id": 2,
      "action_type": "login",
      "ip_address": "192.168.1.1",
      "created_at": "2026-01-13T09:00:00Z"
    }
  ]
}
```

---

## 🎨 Employee Dashboard Features

### 1. **Stats Overview**
- 📅 Upcoming Bookings Count
- 🚫 Blocked Dates Count
- 📝 Recent Changes Count

### 2. **Block Date Management**
- Simple date picker
- Optional reason field
- One-click block
- View all blocked dates
- Unblock with confirmation

### 3. **Booking Calendar**
- View all upcoming bookings
- Event details (name, type, location, time)
- Status indicators
- **Read-only** (employees cannot modify bookings)

### 4. **Change Log**
- Last 10 recent actions
- Action type, date, reason
- IP address tracking
- Timestamp for each action

---

## 🔒 Security Features

### 1. **Authentication**
- JWT-based tokens
- Separate employee authentication system
- Token expiration handling
- Secure password hashing (bcrypt)

### 2. **Authorization**
- Employees can only see/manage their own calendar
- Provider ID verification in token
- Cannot access other employees' data
- Cannot modify bookings (read-only)

### 3. **Audit Trail**
- Every action logged with:
  - Employee ID
  - Action type
  - Target date (if applicable)
  - Reason
  - IP address
  - Timestamp
- **Immutable logs** (no DELETE, only INSERT)
- Admin can review all employee changes

### 4. **Rate Limiting**
- Same security middleware as main app
- Protection against brute force
- Progressive lockout on failed attempts

---

## 📱 Mobile Responsive

- ✅ Fully responsive design
- ✅ Touch-friendly buttons
- ✅ Mobile-optimized forms
- ✅ Readable on all screen sizes

---

## 🧪 Testing Instructions

### 1. **Login Test**
1. Go to: https://www.inthehouseproductions.com/employee/login
2. Use any employee credentials:
   - Email: `mike@inthehouseproductions.com`
   - Password: `Employee123!`
3. Should redirect to dashboard

### 2. **Block Date Test**
1. Login as an employee
2. Select a future date
3. Enter optional reason
4. Click "BLOCK DATE"
5. Date should appear in blocked dates list

### 3. **Unblock Date Test**
1. Click "Unblock" on a blocked date
2. Confirm the action
3. Date should be removed from list

### 4. **View Bookings Test**
1. Check "Upcoming Bookings" section
2. Should show all future bookings for that provider
3. Verify read-only (no edit/delete buttons)

### 5. **Change Log Test**
1. Scroll to "Recent Changes" section
2. Should show login, block/unblock actions
3. Verify timestamps and IP addresses

---

## 👨‍💼 Admin Access to Employee Data

### View All Employee Changes
Admins can query the `change_logs` table:

```sql
-- All changes by a specific employee
SELECT * FROM change_logs WHERE employee_id = 1 ORDER BY created_at DESC;

-- All date blocks in a date range
SELECT * FROM change_logs 
WHERE action_type = 'block_date' 
AND target_date BETWEEN '2026-02-01' AND '2026-02-28';

-- Employee login history
SELECT 
  e.full_name, 
  e.provider_id, 
  cl.action_type, 
  cl.ip_address, 
  cl.created_at
FROM change_logs cl
JOIN employees e ON cl.employee_id = e.id
WHERE cl.action_type IN ('login', 'logout')
ORDER BY cl.created_at DESC;
```

### View All Blocked Dates
```sql
SELECT 
  ab.block_date,
  ab.reason,
  e.full_name as employee_name,
  e.provider_id,
  ab.created_at
FROM availability_blocks ab
JOIN employees e ON ab.employee_id = e.id
ORDER BY ab.block_date DESC;
```

---

## 🚀 Deployment Status

- ✅ **Migration Applied**: Local and Production
- ✅ **Build Successful**: 548.70 kB
- ✅ **Deployed**: https://1da65e25.webapp-2mf.pages.dev
- ✅ **Custom Domain**: https://www.inthehouseproductions.com
- ✅ **Git Pushed**: Commit 5742cf8

---

## 📝 Future Enhancements

### Potential Features:
1. **Email Notifications**
   - Notify admins when employees block dates
   - Send confirmation emails to employees

2. **Calendar View**
   - Visual calendar interface
   - Drag-and-drop date blocking

3. **Bulk Operations**
   - Block multiple dates at once
   - Recurring blocks (e.g., every Sunday)

4. **Reports**
   - Employee availability reports
   - Utilization statistics
   - Change history export

5. **Mobile App**
   - Native iOS/Android app
   - Push notifications

---

## 🎯 Summary

**The Employee Portal System is now LIVE and FUNCTIONAL!**

### What Employees Can Do:
✅ Login with their credentials  
✅ View their upcoming bookings (read-only)  
✅ Block dates on their calendar  
✅ Unblock dates  
✅ View their change history  
✅ Logout (tracked in audit trail)  

### What Admins Get:
✅ Complete audit trail of all employee actions  
✅ IP address tracking  
✅ Timestamps for every change  
✅ Reason logging for blocked dates  
✅ Employee activity reports  

### Security:
✅ Separate authentication from customer accounts  
✅ Employees only see their own data  
✅ Cannot modify bookings  
✅ All actions logged  
✅ Rate limiting enabled  

---

**Access the Employee Portal:**  
🔗 https://www.inthehouseproductions.com/employee/login

**Test Credentials:**  
📧 Email: `mike@inthehouseproductions.com`  
🔒 Password: `Employee123!`

---

**Status**: ✅ **COMPLETE AND DEPLOYED**  
**Deployment ID**: 1da65e25  
**Commit**: 5742cf8  
**Migration**: 0010_employee_system.sql ✅
