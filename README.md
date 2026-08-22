# GlobeTrotter 🌍

A complete full-stack travel planning MVP built from the GlobeTrotter hackathon requirements and the supplied 12-screen mockup.

## What is included

- Login / registration with JWT authentication and bcrypt password hashing
- Dashboard with upcoming trips, destinations and budget highlights
- Create, edit and delete trips
- Multi-city trip stops with dates and ordering
- Activity discovery by city and search
- Day-wise itinerary builder
- Expense tracking and automatic budget calculations
- Budget breakdown by transport, stay, meals, activities and other expenses
- Calendar view of planned activities
- Public itinerary links and copy-trip functionality
- Community page for public trips
- User profile, photo upload and saved destinations
- Admin analytics dashboard with users, popular cities and popular activities
- Relational SQLite database with foreign keys and indexes
- Responsive UI for desktop and mobile
- One Express server that serves both the API and frontend, making local deployment simple

The source requirements describe multi-city itineraries, travel dates, activities, budgets, search, cost breakdowns, calendars and sharing, plus a relational database for users, itineraries, stops, activities and expenses. The implementation maps those requirements into the screens and API in this repository.

## Tech stack

- Frontend: HTML, CSS, vanilla JavaScript SPA
- Backend: Node.js + Express
- Database: SQLite + better-sqlite3
- Authentication: JWT + bcryptjs
- Uploads: Multer

## Folder structure

```text
globetrotter/
├── database/
│   ├── schema.sql
│   └── seed.sql
├── public/
│   ├── uploads/
│   │   └── .gitkeep
│   ├── app.js
│   ├── index.html
│   ├── share.html
│   └── styles.css
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── server.js
```

The SQLite database file is created automatically at `data/globetrotter.db` on first run. It is intentionally ignored by Git so each deployment can create its own database.

## Run locally

### 1. Install Node.js

Use Node.js 18 or newer.

### 2. Open the project folder

```bash
cd globetrotter
```

### 3. Install dependencies

```bash
npm install
```

### 4. Start the application

```bash
npm start
```

Open:

```text
http://localhost:3000
```

For development with automatic server restart:

```bash
npm run dev
```

## Demo admin account

```text
Email: admin@globetrotter.local
Password: Admin@123
```

Change the password before a real deployment.

## Main API routes

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

### Destinations and activities

- `GET /api/cities`
- `GET /api/cities/:id/activities`
- `GET /api/activities`

### Trips

- `GET /api/trips`
- `POST /api/trips`
- `GET /api/trips/:id`
- `PUT /api/trips/:id`
- `DELETE /api/trips/:id`

### Stops and activities inside trips

- `POST /api/trips/:id/stops`
- `PUT /api/stops/:id`
- `DELETE /api/stops/:id`
- `POST /api/trips/:id/activities`
- `PUT /api/trip-activities/:id`
- `DELETE /api/trip-activities/:id`

### Budget and calendar

- `POST /api/trips/:id/expenses`
- `DELETE /api/expenses/:id`
- `GET /api/trips/:id/budget`
- `GET /api/calendar?month=YYYY-MM`

### Sharing and community

- `GET /api/public/trips/:token`
- `POST /api/trips/:id/public`
- `POST /api/trips/:id/copy`
- `GET /api/community`

### Profile

- `GET /api/profile`
- `PUT /api/profile`
- `POST /api/profile/photo`
- `POST /api/saved-destinations/:cityId`
- `DELETE /api/saved-destinations/:cityId`
- `DELETE /api/profile`

### Admin

- `GET /api/admin/stats`
- `DELETE /api/admin/users/:id`

## Database design

The database is relational and uses foreign keys:

```text
users
  └── trips
       ├── trip_stops ── cities
       │                   └── activities
       ├── trip_activities ── activities
       └── expenses

users ── saved_destinations ── cities
```

This structure keeps user-specific trip data separate while allowing reusable city and activity records.

## Deploy to Render

This project is intentionally structured as a single web service.

1. Push the repository to GitHub.
2. Create a new **Web Service** on Render.
3. Connect the GitHub repository.
4. Build command:

```text
npm install
```

5. Start command:

```text
npm start
```

6. Add an environment variable:

```text
JWT_SECRET=<a-long-random-secret>
```

### Important database note

SQLite is excellent for a hackathon/demo and makes the repository easy to run. On hosting platforms with ephemeral disks, a restart/redeploy can reset local SQLite data. For production, move the same relational schema to PostgreSQL and keep the API layer mostly unchanged.

## GitHub upload

From the project folder:

```bash
git init
git add .
git commit -m "Build GlobeTrotter full-stack travel planner"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/globetrotter.git
git push -u origin main
```

Do not commit `.env`, `node_modules`, or the generated SQLite database.

## Hackathon demo flow

Use this sequence when presenting:

1. Register a user.
2. Create a trip with dates and budget.
3. Add Paris/Tokyo/etc. as stops.
4. Add activities to individual days.
5. Add a hotel/transport/meal expense.
6. Open the Budget view and show the automatic calculation.
7. Open Calendar and show the day-wise plan.
8. Make the trip public.
9. Open the public link in another tab.
10. Copy the public trip into another account.
11. Show Profile and saved destinations.
12. Log into the admin account and show analytics.

## Scope note

The provided mockup contains 12 primary screens and describes an optional admin/analytics dashboard. The application implements the core functionality behind those screens rather than reproducing every hand-drawn pixel literally.
=======
