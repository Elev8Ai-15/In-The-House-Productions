-- Employees Table
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  provider_id TEXT NOT NULL, -- e.g., 'dj_cease', 'photobooth_unit1'
  service_type TEXT NOT NULL CHECK(service_type IN ('dj', 'photobooth')),
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_employees_email ON employees(email);
CREATE INDEX idx_employees_provider ON employees(provider_id);
CREATE INDEX idx_employees_active ON employees(is_active);

-- Change Log Table (Audit Trail)
CREATE TABLE IF NOT EXISTS change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('block_date', 'unblock_date', 'update_availability', 'login', 'logout')),
  target_date DATE,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX idx_change_logs_employee ON change_logs(employee_id, created_at);
CREATE INDEX idx_change_logs_action ON change_logs(action_type, created_at);
CREATE INDEX idx_change_logs_date ON change_logs(target_date);

-- Update availability_blocks to track employee changes
ALTER TABLE availability_blocks ADD COLUMN employee_id INTEGER REFERENCES employees(id);
ALTER TABLE availability_blocks ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;

-- Insert default employees (Password: Employee123! for all)
-- DJ Cease (Mike Cecil)
INSERT INTO employees (full_name, email, phone, password_hash, provider_id, service_type)
VALUES ('Mike Cecil', 'mike@inthehouseproductions.com', '+1-859-314-4444', '$2a$10$8K1p/a0dL3LKkxuOfSwqWe3hxvlLyDv.qmGK7E6K5uqGb9LnLqJe.', 'dj_cease', 'dj');

-- DJ Elev8 (Brad Powell)
INSERT INTO employees (full_name, email, phone, password_hash, provider_id, service_type)
VALUES ('Brad Powell', 'brad@inthehouseproductions.com', '+1-859-314-4443', '$2a$10$8K1p/a0dL3LKkxuOfSwqWe3hxvlLyDv.qmGK7E6K5uqGb9LnLqJe.', 'dj_elev8', 'dj');

-- TKO the DJ (Joey Tate)
INSERT INTO employees (full_name, email, phone, password_hash, provider_id, service_type)
VALUES ('Joey Tate', 'joey@inthehouseproductions.com', '+1-859-803-2755', '$2a$10$8K1p/a0dL3LKkxuOfSwqWe3hxvlLyDv.qmGK7E6K5uqGb9LnLqJe.', 'tko_the_dj', 'dj');

-- Photobooth Unit 1 (Maria Cecil)
INSERT INTO employees (full_name, email, phone, password_hash, provider_id, service_type)
VALUES ('Maria Cecil', 'maria@inthehouseproductions.com', '+1-859-314-4444', '$2a$10$8K1p/a0dL3LKkxuOfSwqWe3hxvlLyDv.qmGK7E6K5uqGb9LnLqJe.', 'photobooth_unit1', 'photobooth');

-- Photobooth Unit 2 (Cora Scarborough)
INSERT INTO employees (full_name, email, phone, password_hash, provider_id, service_type)
VALUES ('Cora Scarborough', 'cora@inthehouseproductions.com', '+1-859-803-2755', '$2a$10$8K1p/a0dL3LKkxuOfSwqWe3hxvlLyDv.qmGK7E6K5uqGb9LnLqJe.', 'photobooth_unit2', 'photobooth');
