
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT DEFAULT '',
  city TEXT DEFAULT '',
  country TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  photo_url TEXT DEFAULT '',
  language TEXT DEFAULT 'English',
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  description TEXT DEFAULT '',
  cost_index REAL NOT NULL DEFAULT 1,
  popularity INTEGER NOT NULL DEFAULT 0,
  image_url TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  duration_hours REAL NOT NULL DEFAULT 2,
  estimated_cost REAL NOT NULL DEFAULT 0,
  image_url TEXT DEFAULT '',
  FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  description TEXT DEFAULT '',
  cover_photo TEXT DEFAULT '',
  budget REAL NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  share_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trip_stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  city_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  stop_order INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS trip_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  stop_id INTEGER NOT NULL,
  activity_id INTEGER NOT NULL,
  activity_date TEXT NOT NULL,
  start_time TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  estimated_cost REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (stop_id) REFERENCES trip_stops(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  expense_date TEXT NOT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS saved_destinations (
  user_id INTEGER NOT NULL,
  city_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, city_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id);
CREATE INDEX IF NOT EXISTS idx_stops_trip ON trip_stops(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_activities_trip ON trip_activities(trip_id);
CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses(trip_id);
