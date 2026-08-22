const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'globetrotter-dev-secret-change-me';

const root = __dirname;
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const uploadDir = path.join(publicDir, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, 'globetrotter.db'));
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
db.exec(schema);

function seed() {
  const cityCount = db.prepare('SELECT COUNT(*) c FROM cities').get().c;
  if (cityCount === 0) db.exec(fs.readFileSync(path.join(root, 'database', 'seed.sql'), 'utf8'));
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@globetrotter.local');
  if (!admin) {
    const hash = bcrypt.hashSync('Admin@123', 10);
    db.prepare(`INSERT INTO users (username,password_hash,first_name,last_name,email,city,country,role)
      VALUES (?,?,?,?,?,?,?,?)`).run('admin', hash, 'Globe', 'Admin', 'admin@globetrotter.local', 'Ahmedabad', 'India', 'admin');
  }
}
seed();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  }
});

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Session expired. Please login again.' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}
function cleanUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}
function dateList(start, end) {
  const out = [];
  const a = new Date(`${start}T00:00:00`), b = new Date(`${end}T00:00:00`);
  while (a <= b) { out.push(a.toISOString().slice(0, 10)); a.setDate(a.getDate() + 1); }
  return out;
}
function totalTripCost(tripId) {
  const a = db.prepare('SELECT COALESCE(SUM(estimated_cost),0) total FROM trip_activities WHERE trip_id=?').get(tripId).total;
  const e = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE trip_id=?').get(tripId).total;
  return Number(a) + Number(e);
}
function tripSummary(trip) {
  const stops = db.prepare(`SELECT ts.*, c.name city_name, c.country, c.region, c.image_url
    FROM trip_stops ts JOIN cities c ON c.id=ts.city_id WHERE ts.trip_id=? ORDER BY ts.stop_order`).all(trip.id);
  const activities = db.prepare(`SELECT ta.*, a.name activity_name, a.category, a.description, a.duration_hours
    FROM trip_activities ta JOIN activities a ON a.id=ta.activity_id WHERE ta.trip_id=? ORDER BY ta.activity_date, ta.position, ta.start_time`).all(trip.id);
  const expenses = db.prepare('SELECT * FROM expenses WHERE trip_id=? ORDER BY expense_date DESC, id DESC').all(trip.id);
  return { ...trip, stops, activities, expenses, total_cost: totalTripCost(trip.id) };
}

// Auth
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, firstName, lastName, email, phone='', city='', country='', bio='' } = req.body;
    if (!username || !password || !firstName || !lastName || !email) return res.status(400).json({ error: 'Username, password, first name, last name and email are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const hash = await bcrypt.hash(password, 10);
    const info = db.prepare(`INSERT INTO users (username,password_hash,first_name,last_name,email,phone,city,country,bio)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(username.trim(), hash, firstName.trim(), lastName.trim(), email.trim().toLowerCase(), phone, city, country, bio);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    res.status(201).json({ token: tokenFor(user), user: cleanUser(user) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Username or email already exists.' });
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(usernameOrEmail?.trim(), usernameOrEmail?.trim().toLowerCase());
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) return res.status(401).json({ error: 'Invalid username/email or password.' });
  res.json({ token: tokenFor(user), user: cleanUser(user) });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: cleanUser(user) });
});

// Cities / activities
app.get('/api/cities', (req, res) => {
  const q = (req.query.q || '').trim();
  const region = (req.query.region || '').trim();
  const sort = req.query.sort === 'cost' ? 'cost_index ASC' : req.query.sort === 'name' ? 'name ASC' : 'popularity DESC';
  let sql = 'SELECT * FROM cities WHERE 1=1'; const params = [];
  if (q) { sql += ' AND (name LIKE ? OR country LIKE ? OR region LIKE ?)'; params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  if (region) { sql += ' AND region=?'; params.push(region); }
  sql += ` ORDER BY ${sort} LIMIT 100`;
  res.json({ cities: db.prepare(sql).all(...params) });
});
app.get('/api/cities/:id/activities', (req, res) => {
  const { q='', category='' } = req.query;
  let sql = 'SELECT * FROM activities WHERE city_id=?'; const p = [req.params.id];
  if (q) { sql += ' AND (name LIKE ? OR description LIKE ?)'; p.push(`%${q}%`,`%${q}%`); }
  if (category) { sql += ' AND category=?'; p.push(category); }
  sql += ' ORDER BY estimated_cost ASC, name ASC';
  res.json({ activities: db.prepare(sql).all(...p) });
});
app.get('/api/activities', (req,res)=>{
  const { q='', category='', cityId='' } = req.query;
  let sql = `SELECT a.*, c.name city_name, c.country FROM activities a JOIN cities c ON c.id=a.city_id WHERE 1=1`; const p=[];
  if(q){sql += ' AND (a.name LIKE ? OR a.description LIKE ? OR c.name LIKE ?)'; p.push(`%${q}%`,`%${q}%`,`%${q}%`)}
  if(category){sql += ' AND a.category=?';p.push(category)}
  if(cityId){sql += ' AND a.city_id=?';p.push(cityId)}
  sql += ' ORDER BY a.name LIMIT 100';
  res.json({activities:db.prepare(sql).all(...p)});
});

// Trips
app.get('/api/trips', auth, (req,res)=>{
  const trips = db.prepare(`SELECT t.*, COUNT(DISTINCT ts.id) stop_count, COUNT(DISTINCT ta.id) activity_count
    FROM trips t LEFT JOIN trip_stops ts ON ts.trip_id=t.id LEFT JOIN trip_activities ta ON ta.trip_id=t.id
    WHERE t.user_id=? GROUP BY t.id ORDER BY t.start_date ASC, t.id DESC`).all(req.user.id);
  res.json({ trips: trips.map(t=>({...t,total_cost:totalTripCost(t.id)})) });
});

app.post('/api/trips', auth, (req,res)=>{
  const { name, startDate, endDate, description='', budget=0, coverPhoto='', isPublic=false } = req.body;
  if(!name || !startDate || !endDate) return res.status(400).json({error:'Trip name, start date and end date are required.'});
  if(startDate > endDate) return res.status(400).json({error:'End date must be on or after start date.'});
  const share = crypto.randomBytes(12).toString('hex');
  const info = db.prepare(`INSERT INTO trips (user_id,name,start_date,end_date,description,budget,cover_photo,is_public,share_token)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(req.user.id,name,startDate,endDate,description,Number(budget)||0,coverPhoto, isPublic?1:0, share);
  res.status(201).json({ trip: tripSummary(db.prepare('SELECT * FROM trips WHERE id=?').get(info.lastInsertRowid)) });
});

app.get('/api/trips/:id', auth, (req,res)=>{
  const trip = db.prepare('SELECT * FROM trips WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if(!trip) return res.status(404).json({error:'Trip not found.'});
  res.json({trip:tripSummary(trip)});
});

app.put('/api/trips/:id', auth, (req,res)=>{
  const trip = db.prepare('SELECT * FROM trips WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if(!trip) return res.status(404).json({error:'Trip not found.'});
  const fields = {
    name:req.body.name ?? trip.name, start_date:req.body.startDate ?? trip.start_date, end_date:req.body.endDate ?? trip.end_date,
    description:req.body.description ?? trip.description, budget:Number(req.body.budget ?? trip.budget)||0,
    cover_photo:req.body.coverPhoto ?? trip.cover_photo, is_public:req.body.isPublic===undefined?trip.is_public:(req.body.isPublic?1:0)
  };
  db.prepare(`UPDATE trips SET name=?,start_date=?,end_date=?,description=?,budget=?,cover_photo=?,is_public=? WHERE id=?`).run(fields.name,fields.start_date,fields.end_date,fields.description,fields.budget,fields.cover_photo,fields.is_public,trip.id);
  res.json({trip:tripSummary(db.prepare('SELECT * FROM trips WHERE id=?').get(trip.id))});
});

app.delete('/api/trips/:id', auth, (req,res)=>{
  const info=db.prepare('DELETE FROM trips WHERE id=? AND user_id=?').run(req.params.id,req.user.id);
  if(!info.changes)return res.status(404).json({error:'Trip not found.'});
  res.json({ok:true});
});

app.post('/api/trips/:id/stops', auth, (req,res)=>{
  const trip=db.prepare('SELECT * FROM trips WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if(!trip)return res.status(404).json({error:'Trip not found.'});
  const {cityId,startDate,endDate}=req.body;
  if(!cityId||!startDate||!endDate)return res.status(400).json({error:'City and stop dates are required.'});
  if(startDate<trip.start_date||endDate>trip.end_date||startDate>endDate)return res.status(400).json({error:'Stop dates must be inside the trip date range.'});
  const order=(db.prepare('SELECT COALESCE(MAX(stop_order),0)+1 n FROM trip_stops WHERE trip_id=?').get(trip.id).n);
  const info=db.prepare('INSERT INTO trip_stops (trip_id,city_id,start_date,end_date,stop_order) VALUES (?,?,?,?,?)').run(trip.id,cityId,startDate,endDate,order);
  res.status(201).json({stop:db.prepare(`SELECT ts.*,c.name city_name,c.country,c.image_url FROM trip_stops ts JOIN cities c ON c.id=ts.city_id WHERE ts.id=?`).get(info.lastInsertRowid)});
});
app.put('/api/stops/:id', auth, (req,res)=>{
  const stop=db.prepare(`SELECT ts.*,t.user_id,t.start_date trip_start,t.end_date trip_end FROM trip_stops ts JOIN trips t ON t.id=ts.trip_id WHERE ts.id=? AND t.user_id=?`).get(req.params.id,req.user.id);
  if(!stop)return res.status(404).json({error:'Stop not found.'});
  const start=req.body.startDate||stop.start_date,end=req.body.endDate||stop.end_date;
  if(start<stop.trip_start||end>stop.trip_end||start>end)return res.status(400).json({error:'Invalid stop dates.'});
  db.prepare('UPDATE trip_stops SET start_date=?,end_date=?,stop_order=? WHERE id=?').run(start,end,Number(req.body.order||stop.stop_order),stop.id);
  res.json({ok:true});
});
app.delete('/api/stops/:id', auth, (req,res)=>{
  const info=db.prepare(`DELETE FROM trip_stops WHERE id IN (SELECT ts.id FROM trip_stops ts JOIN trips t ON t.id=ts.trip_id WHERE ts.id=? AND t.user_id=?)`).run(req.params.id,req.user.id);
  if(!info.changes)return res.status(404).json({error:'Stop not found.'}); res.json({ok:true});
});

app.post('/api/trips/:id/activities', auth, (req,res)=>{
  const trip=db.prepare('SELECT * FROM trips WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if(!trip)return res.status(404).json({error:'Trip not found.'});
  const {stopId,activityId,activityDate,startTime='',notes='',estimatedCost}=req.body;
  const stop=db.prepare('SELECT * FROM trip_stops WHERE id=? AND trip_id=?').get(stopId,trip.id);
  const activity=db.prepare('SELECT * FROM activities WHERE id=?').get(activityId);
  if(!stop||!activity)return res.status(400).json({error:'Valid stop and activity are required.'});
  if(activityDate<stop.start_date||activityDate>stop.end_date)return res.status(400).json({error:'Activity date must be inside the stop dates.'});
  const position=db.prepare('SELECT COALESCE(MAX(position),0)+1 n FROM trip_activities WHERE stop_id=? AND activity_date=?').get(stop.id,activityDate).n;
  const info=db.prepare(`INSERT INTO trip_activities (trip_id,stop_id,activity_id,activity_date,start_time,notes,estimated_cost,position)
    VALUES (?,?,?,?,?,?,?,?)`).run(trip.id,stop.id,activity.id,activityDate,startTime,notes,estimatedCost===undefined?activity.estimated_cost:Number(estimatedCost)||0,position);
  res.status(201).json({activity:db.prepare(`SELECT ta.*,a.name activity_name,a.category,a.description,a.duration_hours FROM trip_activities ta JOIN activities a ON a.id=ta.activity_id WHERE ta.id=?`).get(info.lastInsertRowid)});
});
app.put('/api/trip-activities/:id', auth, (req,res)=>{
  const row=db.prepare(`SELECT ta.*,t.user_id FROM trip_activities ta JOIN trips t ON t.id=ta.trip_id WHERE ta.id=? AND t.user_id=?`).get(req.params.id,req.user.id);
  if(!row)return res.status(404).json({error:'Activity not found.'});
  db.prepare(`UPDATE trip_activities SET activity_date=?,start_time=?,notes=?,estimated_cost=?,position=? WHERE id=?`).run(
    req.body.activityDate||row.activity_date, req.body.startTime??row.start_time, req.body.notes??row.notes,
    req.body.estimatedCost===undefined?row.estimated_cost:Number(req.body.estimatedCost)||0, Number(req.body.position||row.position), row.id);
  res.json({ok:true});
});
app.delete('/api/trip-activities/:id', auth, (req,res)=>{
  const info=db.prepare(`DELETE FROM trip_activities WHERE id IN (SELECT ta.id FROM trip_activities ta JOIN trips t ON t.id=ta.trip_id WHERE ta.id=? AND t.user_id=?)`).run(req.params.id,req.user.id);
  if(!info.changes)return res.status(404).json({error:'Activity not found.'});res.json({ok:true});
});

// Expenses / budget
app.post('/api/trips/:id/expenses', auth, (req,res)=>{
  const trip=db.prepare('SELECT id FROM trips WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if(!trip)return res.status(404).json({error:'Trip not found.'});
  const {category,description,amount,expenseDate}=req.body;
  if(!category||!description||amount===undefined||!expenseDate)return res.status(400).json({error:'All expense fields are required.'});
  const info=db.prepare('INSERT INTO expenses (trip_id,category,description,amount,expense_date) VALUES (?,?,?,?,?)').run(trip.id,category,description,Number(amount)||0,expenseDate);
  res.status(201).json({expense:db.prepare('SELECT * FROM expenses WHERE id=?').get(info.lastInsertRowid)});
});
app.delete('/api/expenses/:id',auth,(req,res)=>{
  const info=db.prepare(`DELETE FROM expenses WHERE id IN (SELECT e.id FROM expenses e JOIN trips t ON t.id=e.trip_id WHERE e.id=? AND t.user_id=?)`).run(req.params.id,req.user.id);
  if(!info.changes)return res.status(404).json({error:'Expense not found.'});res.json({ok:true});
});
app.get('/api/trips/:id/budget',auth,(req,res)=>{
  const trip=db.prepare('SELECT * FROM trips WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if(!trip)return res.status(404).json({error:'Trip not found.'});
  const categories=db.prepare(`SELECT category,ROUND(SUM(amount),2) amount FROM (
      SELECT CASE WHEN category='activity' THEN 'Activities' ELSE category END category, amount FROM expenses WHERE trip_id=?
      UNION ALL SELECT 'Activities',estimated_cost FROM trip_activities WHERE trip_id=?
    ) GROUP BY category ORDER BY amount DESC`).all(trip.id,trip.id);
  const total=totalTripCost(trip.id), daily={};
  for(const d of dateList(trip.start_date,trip.end_date)){
    daily[d]=db.prepare(`SELECT ROUND(COALESCE((SELECT SUM(estimated_cost) FROM trip_activities WHERE trip_id=? AND activity_date=?),0)+COALESCE((SELECT SUM(amount) FROM expenses WHERE trip_id=? AND expense_date=?),0),2) amount`).get(trip.id,d,trip.id,d).amount;
  }
  res.json({budget:trip.budget,total,categories,daily,remaining:Number(trip.budget)-Number(total),averagePerDay:dateList(trip.start_date,trip.end_date).length?total/dateList(trip.start_date,trip.end_date).length:0});
});

// Calendar
app.get('/api/calendar',auth,(req,res)=>{
  const month=req.query.month||new Date().toISOString().slice(0,7);
  const items=db.prepare(`SELECT ta.activity_date date, ta.start_time, ta.estimated_cost, a.name activity_name, c.name city_name, t.name trip_name, t.id trip_id
    FROM trip_activities ta JOIN activities a ON a.id=ta.activity_id JOIN trip_stops ts ON ts.id=ta.stop_id JOIN cities c ON c.id=ts.city_id JOIN trips t ON t.id=ta.trip_id
    WHERE t.user_id=? AND substr(ta.activity_date,1,7)=? ORDER BY ta.activity_date,ta.start_time`).all(req.user.id,month);
  const trips=db.prepare(`SELECT id,name,start_date,end_date FROM trips WHERE user_id=? AND (substr(start_date,1,7)=? OR substr(end_date,1,7)=? OR (start_date<? AND end_date>?)) ORDER BY start_date`).all(req.user.id,month,month,`${month}-31`,`${month}-01`);
  res.json({items,trips});
});

// Public sharing / community
app.get('/api/public/trips/:token',(req,res)=>{
  const trip=db.prepare(`SELECT t.*,u.first_name,u.last_name,u.username FROM trips t JOIN users u ON u.id=t.user_id WHERE t.share_token=? AND t.is_public=1`).get(req.params.token);
  if(!trip)return res.status(404).json({error:'Public trip not found.'});
  res.json({trip:tripSummary(trip),owner:{first_name:trip.first_name,last_name:trip.last_name,username:trip.username}});
});
app.post('/api/trips/:id/public',auth,(req,res)=>{
  const trip=db.prepare('SELECT * FROM trips WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if(!trip)return res.status(404).json({error:'Trip not found.'});
  db.prepare('UPDATE trips SET is_public=? WHERE id=?').run(req.body.isPublic?1:0,trip.id);
  res.json({public:!!req.body.isPublic,token:trip.share_token});
});
app.post('/api/trips/:id/copy',auth,(req,res)=>{
  const source=db.prepare('SELECT * FROM trips WHERE id=? AND is_public=1').get(req.params.id);
  if(!source)return res.status(404).json({error:'Public trip not found.'});
  const share=crypto.randomBytes(12).toString('hex');
  const info=db.prepare(`INSERT INTO trips (user_id,name,start_date,end_date,description,budget,cover_photo,is_public,share_token)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(req.user.id,`${source.name} (Copy)`,source.start_date,source.end_date,source.description,source.budget,source.cover_photo,0,share);
  const newTripId=info.lastInsertRowid;
  const stops=db.prepare('SELECT * FROM trip_stops WHERE trip_id=? ORDER BY stop_order').all(source.id);
  const map=new Map();
  const insertStop=db.prepare('INSERT INTO trip_stops (trip_id,city_id,start_date,end_date,stop_order) VALUES (?,?,?,?,?)');
  const insertAct=db.prepare(`INSERT INTO trip_activities (trip_id,stop_id,activity_id,activity_date,start_time,notes,estimated_cost,position) VALUES (?,?,?,?,?,?,?,?)`);
  const copy=db.transaction(()=>{
    for(const s of stops){const x=insertStop.run(newTripId,s.city_id,s.start_date,s.end_date,s.stop_order);map.set(s.id,x.lastInsertRowid);}
    for(const a of db.prepare('SELECT * FROM trip_activities WHERE trip_id=?').all(source.id)) insertAct.run(newTripId,map.get(a.stop_id),a.activity_id,a.activity_date,a.start_time,a.notes,a.estimated_cost,a.position);
  });
  copy();
  res.status(201).json({trip:tripSummary(db.prepare('SELECT * FROM trips WHERE id=?').get(newTripId))});
});
app.get('/api/community', (req,res)=>{
  const q=(req.query.q||'').trim();
  const params=[]; let sql=`SELECT t.id,t.name,t.start_date,t.end_date,t.description,t.cover_photo,t.share_token,u.first_name,u.last_name,u.username,
    COUNT(DISTINCT ts.city_id) stop_count, COALESCE(SUM(ta.estimated_cost),0) total_cost
    FROM trips t JOIN users u ON u.id=t.user_id LEFT JOIN trip_stops ts ON ts.trip_id=t.id LEFT JOIN trip_activities ta ON ta.trip_id=t.id WHERE t.is_public=1`;
  if(q){sql+=' AND (t.name LIKE ? OR t.description LIKE ? OR u.username LIKE ?)';params.push(`%${q}%`,`%${q}%`,`%${q}%`)}
  sql+=' GROUP BY t.id ORDER BY t.created_at DESC LIMIT 50';
  res.json({trips:db.prepare(sql).all(...params)});
});

// Profile
app.get('/api/profile',auth,(req,res)=>{
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const saved=db.prepare(`SELECT c.* FROM saved_destinations s JOIN cities c ON c.id=s.city_id WHERE s.user_id=? ORDER BY s.created_at DESC`).all(req.user.id);
  res.json({user:cleanUser(user),saved});
});
app.put('/api/profile',auth,(req,res)=>{
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const data={firstName:req.body.firstName??u.first_name,lastName:req.body.lastName??u.last_name,email:(req.body.email??u.email).toLowerCase(),phone:req.body.phone??u.phone,city:req.body.city??u.city,country:req.body.country??u.country,bio:req.body.bio??u.bio,language:req.body.language??u.language,photoUrl:req.body.photoUrl??u.photo_url};
  try{
    db.prepare(`UPDATE users SET first_name=?,last_name=?,email=?,phone=?,city=?,country=?,bio=?,language=?,photo_url=? WHERE id=?`).run(data.firstName,data.lastName,data.email,data.phone,data.city,data.country,data.bio,data.language,data.photoUrl,u.id);
    res.json({user:cleanUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id))});
  }catch(e){res.status(409).json({error:'Email is already used by another account.'})}
});
app.post('/api/profile/photo',auth,upload.single('photo'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Photo is required.'});
  const url=`/uploads/${req.file.filename}`;
  db.prepare('UPDATE users SET photo_url=? WHERE id=?').run(url,req.user.id);
  res.json({photoUrl:url});
});
app.post('/api/saved-destinations/:cityId',auth,(req,res)=>{
  const city=db.prepare('SELECT id FROM cities WHERE id=?').get(req.params.cityId); if(!city)return res.status(404).json({error:'City not found.'});
  db.prepare('INSERT OR IGNORE INTO saved_destinations (user_id,city_id) VALUES (?,?)').run(req.user.id,city.id);res.json({ok:true});
});
app.delete('/api/saved-destinations/:cityId',auth,(req,res)=>{db.prepare('DELETE FROM saved_destinations WHERE user_id=? AND city_id=?').run(req.user.id,req.params.cityId);res.json({ok:true})});
app.delete('/api/profile',auth,(req,res)=>{db.prepare('DELETE FROM users WHERE id=?').run(req.user.id);res.json({ok:true})});

// Admin analytics
app.get('/api/admin/stats',auth,adminOnly,(req,res)=>{
  const users=db.prepare("SELECT COUNT(*) c FROM users WHERE role='user'").get().c;
  const trips=db.prepare('SELECT COUNT(*) c FROM trips').get().c;
  const publicTrips=db.prepare('SELECT COUNT(*) c FROM trips WHERE is_public=1').get().c;
  const activities=db.prepare('SELECT COUNT(*) c FROM trip_activities').get().c;
  const topCities=db.prepare(`SELECT c.name,c.country,COUNT(*) visits FROM trip_stops ts JOIN cities c ON c.id=ts.city_id GROUP BY c.id ORDER BY visits DESC LIMIT 8`).all();
  const topActivities=db.prepare(`SELECT a.name,a.category,COUNT(*) uses FROM trip_activities ta JOIN activities a ON a.id=ta.activity_id GROUP BY a.id ORDER BY uses DESC LIMIT 8`).all();
  const usersList=db.prepare(`SELECT id,username,first_name,last_name,email,role,created_at FROM users ORDER BY created_at DESC LIMIT 50`).all();
  const monthly=db.prepare(`SELECT substr(created_at,1,7) month,COUNT(*) users FROM users GROUP BY month ORDER BY month DESC LIMIT 6`).all();
  res.json({stats:{users,trips,publicTrips,activities},topCities,topActivities,users:usersList,monthly});
});
app.delete('/api/admin/users/:id',auth,adminOnly,(req,res)=>{if(Number(req.params.id)===req.user.id)return res.status(400).json({error:'You cannot delete yourself.'});db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);res.json({ok:true})});

app.get('/api/health',(req,res)=>res.json({ok:true,app:'GlobeTrotter'}));
app.get('*',(req,res)=>res.sendFile(path.join(publicDir,'index.html')));

app.use((err,req,res,next)=>{console.error(err);res.status(400).json({error:err.message||'Request failed.'})});

app.listen(PORT,()=>console.log(`GlobeTrotter running at http://localhost:${PORT}`));
