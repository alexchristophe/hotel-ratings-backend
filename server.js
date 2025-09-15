require('dotenv').config(); // Load environment variables from .env

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware - Configure CORS for Chrome extensions and Microsoft Edge
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://www.booking.com',
    /^chrome-extension:\/\//,
    /^moz-extension:\/\//,
    /^extension:\/\//  // Microsoft Edge extensions
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json()); // Make sure this is before routes

// Connect to MongoDB Atlas using connection string from environment variable
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('Error: MONGODB_URI environment variable not set');
  process.exit(1);
}

mongoose.connect(mongoUri)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Define schema and model for bedding ratings with timestamps
const ratingSchema = new mongoose.Schema({
  hotelKey: { type: String, required: true, index: true },
  hotelName: String,
  hotelAddress: String,
  bedSize: String,
  bedComfort: String,
  bedcoverSize: String,
  bedcoverComfort: String,
  pillowSize: String,
  pillowComfort: String,
  // Phase 3: Abuse prevention fields
  fingerprint: { type: String, required: true, index: true },
  ipAddress: { type: String, required: true, index: true },
  submissionTime: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

const Rating = mongoose.model('Rating', ratingSchema);

// Rate limiting schema for abuse prevention
const rateLimitSchema = new mongoose.Schema({
  identifier: { type: String, required: true, unique: true }, // IP or fingerprint+hotelKey
  type: { type: String, enum: ['ip', 'fingerprint_hotel'], required: true },
  lastSubmission: { type: Date, required: true },
  count: { type: Number, default: 1 }
});

const RateLimit = mongoose.model('RateLimit', rateLimitSchema);

// Helper function to get client IP address
function getClientIP(req) {
  return req.headers['x-forwarded-for'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
         '127.0.0.1';
}

// Helper function to check rate limits
async function checkRateLimit(fingerprint, hotelKey, ipAddress) {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  // Check IP rate limit (1 per week per IP)
  const ipLimit = await RateLimit.findOne({
    identifier: ipAddress,
    type: 'ip',
    lastSubmission: { $gte: oneWeekAgo }
  });
  
  if (ipLimit) {
    return { allowed: false, reason: 'IP rate limit: Only 1 rating per week per IP address' };
  }
  
  // Check fingerprint+hotel rate limit (1 per week per fingerprint per hotel)
  const fingerprintHotelId = `${fingerprint}|${hotelKey}`;
  const fingerprintLimit = await RateLimit.findOne({
    identifier: fingerprintHotelId,
    type: 'fingerprint_hotel',
    lastSubmission: { $gte: oneWeekAgo }
  });
  
  if (fingerprintLimit) {
    return { allowed: false, reason: 'Fingerprint rate limit: Only 1 rating per week per browser per hotel' };
  }
  
  return { allowed: true };
}

// Helper function to update rate limits
async function updateRateLimit(fingerprint, hotelKey, ipAddress) {
  const now = new Date();
  
  // Update IP rate limit
  await RateLimit.findOneAndUpdate(
    { identifier: ipAddress, type: 'ip' },
    { lastSubmission: now, count: 1 },
    { upsert: true }
  );
  
  // Update fingerprint+hotel rate limit
  const fingerprintHotelId = `${fingerprint}|${hotelKey}`;
  await RateLimit.findOneAndUpdate(
    { identifier: fingerprintHotelId, type: 'fingerprint_hotel' },
    { lastSubmission: now, count: 1 },
    { upsert: true }
  );
}

// Basic route to test server
app.get('/', (req, res) => {
  res.send('Hotel Rating Backend is running');
});

// GET /ratings?hotelKey=...
app.get('/ratings', async (req, res) => {
  const hotelKey = req.query.hotelKey;
  if (!hotelKey) {
    return res.status(400).json({ error: 'Missing hotelKey parameter' });
  }

  try {
    const ratings = await Rating.find({ hotelKey }).sort({ createdAt: -1 }).exec();
    res.json(ratings);
  } catch (err) {
    console.error('Error fetching ratings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Phase 2: GET /ratings/summary/:hotelKey - Aggregate rating percentages
app.get('/ratings/summary/:hotelKey', async (req, res) => {
  const { hotelKey } = req.params;
  
  if (!hotelKey) {
    return res.status(400).json({ error: 'Missing hotelKey parameter' });
  }

  try {
    console.log(`Fetching rating summary for hotel: ${hotelKey}`);
    
    // Get all ratings for this hotel
    const ratings = await Rating.find({ hotelKey }).exec();
    
    if (ratings.length === 0) {
      return res.json({
        hotelKey,
        totalRatings: 0,
        message: 'No ratings found for this hotel'
      });
    }

    // Calculate percentages for each category
    const categories = ['bedSize', 'bedComfort', 'bedcoverSize', 'bedcoverComfort', 'pillowSize', 'pillowComfort'];
    const summary = {
      hotelKey,
      totalRatings: ratings.length
    };

    categories.forEach(category => {
      // Count ratings for this category (exclude empty/null values)
      const categoryRatings = ratings.filter(r => r[category] && r[category].trim() !== '');
      
      if (categoryRatings.length === 0) {
        summary[category] = { total: 0, top2: [] };
        return;
      }

      // Count occurrences of each rating value
      const counts = {};
      categoryRatings.forEach(rating => {
        const value = rating[category];
        counts[value] = (counts[value] || 0) + 1;
      });

      // Sort by count and get top 2
      const sortedRatings = Object.entries(counts)
        .map(([rating, count]) => ({
          rating,
          count,
          percentage: Math.round((count / categoryRatings.length) * 100 * 10) / 10 // Round to 1 decimal
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 2);

      summary[category] = {
        total: categoryRatings.length,
        top2: sortedRatings
      };
    });

    console.log(`Rating summary calculated for ${hotelKey}:`, summary);
    res.json(summary);

  } catch (err) {
    console.error('Error calculating rating summary:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /ratings - Enhanced with rate limiting
app.post('/ratings', async (req, res) => {
  if (!req.body) {
    return res.status(400).json({ error: 'Request body is missing' });
  }

  console.log('Received POST /ratings body:', req.body);

  const ratingData = req.body;

  if (!ratingData.hotelKey) {
    return res.status(400).json({ error: 'Missing hotelKey in rating' });
  }

  if (!ratingData.fingerprint) {
    return res.status(400).json({ error: 'Missing fingerprint for abuse prevention' });
  }

  // Get client IP
  const ipAddress = getClientIP(req);
  console.log(`Rating submission from IP: ${ipAddress}, Fingerprint: ${ratingData.fingerprint}`);

  // Check rate limits
  try {
    const rateLimitCheck = await checkRateLimit(ratingData.fingerprint, ratingData.hotelKey, ipAddress);
    if (!rateLimitCheck.allowed) {
      console.log(`Rate limit exceeded: ${rateLimitCheck.reason}`);
      return res.status(429).json({ 
        error: 'Rate limit exceeded', 
        message: rateLimitCheck.reason,
        retryAfter: '1 week'
      });
    }
  } catch (err) {
    console.error('Error checking rate limits:', err);
    return res.status(500).json({ error: 'Internal server error during rate limit check' });
  }

  // Validate at least one rating field is present
  const ratingFields = [
    'bedSize', 'bedComfort',
    'bedcoverSize', 'bedcoverComfort',
    'pillowSize', 'pillowComfort'
  ];

  const hasAtLeastOneRating = ratingFields.some(field => ratingData[field] && ratingData[field].trim() !== '');

  if (!hasAtLeastOneRating) {
    return res.status(400).json({ error: 'At least one rating field must be provided' });
  }

  try {
    const rating = new Rating({
      hotelKey: ratingData.hotelKey,
      hotelName: ratingData.hotelName,
      hotelAddress: ratingData.hotelAddress,
      bedSize: ratingData.bedSize,
      bedComfort: ratingData.bedComfort,
      bedcoverSize: ratingData.bedcoverSize,
      bedcoverComfort: ratingData.bedcoverComfort,
      pillowSize: ratingData.pillowSize,
      pillowComfort: ratingData.pillowComfort,
      // Phase 3: Abuse prevention fields
      fingerprint: ratingData.fingerprint,
      ipAddress: ipAddress,
      submissionTime: new Date()
    });

    await rating.save();
    
    // Update rate limits after successful save
    await updateRateLimit(ratingData.fingerprint, ratingData.hotelKey, ipAddress);
    
    console.log('Rating saved successfully with rate limit tracking');
    res.status(201).json({ message: 'Rating submitted successfully', rating });
  } catch (err) {
    console.error('Error saving rating:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
