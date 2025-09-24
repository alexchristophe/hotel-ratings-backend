require('dotenv').config(); // Load environment variables from .env

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware - Configure CORS for Chrome extensions
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
app.use(express.json());

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

// Define schema and model for hotel bedding ratings ONLY
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
  lightAnnoyances: { type: [String], default: [] }, // Light annoyances array
  noise: { type: [String], default: [] }, // Noise issues array
  // Abuse prevention fields
  fingerprint: { type: String, required: true, index: true },
  ipAddress: { type: String, required: true, index: true },
  submissionTime: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

const Rating = mongoose.model('Rating', ratingSchema);

// Rate limiting schema for hotel ratings only
const rateLimitSchema = new mongoose.Schema({
  identifier: { type: String, required: true, unique: true }, // IP+hotelKey or fingerprint+hotelKey
  type: { type: String, enum: ['ip_hotel', 'fingerprint_hotel'], required: true },
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

// Helper function to check rate limits for hotels
async function checkRateLimit(fingerprint, hotelKey, ipAddress) {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  // Check IP+Hotel rate limit (1 per week per IP per hotel)
  const ipHotelId = `${ipAddress}|${hotelKey}`;
  const ipLimit = await RateLimit.findOne({
    identifier: ipHotelId,
    type: 'ip_hotel',
    lastSubmission: { $gte: oneWeekAgo }
  });
  
  if (ipLimit) {
    return { allowed: false, reason: 'IP rate limit: Only 1 rating per week per IP address per hotel' };
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

// Helper function to update rate limits for hotels
async function updateRateLimit(fingerprint, hotelKey, ipAddress) {
  const now = new Date();
  
  // Update IP+Hotel rate limit
  const ipHotelId = `${ipAddress}|${hotelKey}`;
  await RateLimit.findOneAndUpdate(
    { identifier: ipHotelId, type: 'ip_hotel' },
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
  res.send('Hotel Bedding Rating Backend - Supports Bedding, Light Annoyances, and Noise Categories!');
});

// GET /ratings?hotelKey=... - Get all ratings for a hotel
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

// GET /ratings/summary/:hotelKey - Get rating summary with percentages
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

    // Calculate percentages for bedding categories
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
          percentage: Math.round((count / categoryRatings.length) * 100 * 10) / 10
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 2);

      summary[category] = {
        total: categoryRatings.length,
        top2: sortedRatings
      };
    });

    // Handle light annoyances aggregation
    const lightAnnoyancesRatings = ratings.filter(r => r.lightAnnoyances && r.lightAnnoyances.length > 0);
    
    if (lightAnnoyancesRatings.length > 0) {
      const annoyanceCounts = {};
      
      lightAnnoyancesRatings.forEach(rating => {
        rating.lightAnnoyances.forEach(annoyance => {
          annoyanceCounts[annoyance] = (annoyanceCounts[annoyance] || 0) + 1;
        });
      });

      const sortedAnnoyances = Object.entries(annoyanceCounts)
        .map(([annoyance, count]) => ({
          rating: annoyance,
          count,
          percentage: Math.round((count / lightAnnoyancesRatings.length) * 100 * 10) / 10
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 2);

      summary.lightAnnoyances = {
        total: lightAnnoyancesRatings.length,
        top2: sortedAnnoyances
      };
    } else {
      summary.lightAnnoyances = { total: 0, top2: [] };
    }

    // Handle noise aggregation
    const noiseRatings = ratings.filter(r => r.noise && r.noise.length > 0);
    
    if (noiseRatings.length > 0) {
      const noiseCounts = {};
      
      noiseRatings.forEach(rating => {
        rating.noise.forEach(noiseIssue => {
          noiseCounts[noiseIssue] = (noiseCounts[noiseIssue] || 0) + 1;
        });
      });

      const sortedNoise = Object.entries(noiseCounts)
        .map(([noiseIssue, count]) => ({
          rating: noiseIssue,
          count,
          percentage: Math.round((count / noiseRatings.length) * 100 * 10) / 10
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 2);

      summary.noise = {
        total: noiseRatings.length,
        top2: sortedNoise
      };
    } else {
      summary.noise = { total: 0, top2: [] };
    }

    console.log(`Rating summary calculated for ${hotelKey}:`, summary);
    res.json(summary);

  } catch (err) {
    console.error('Error calculating rating summary:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /ratings - Submit hotel bedding rating with light annoyances and noise
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

  // Validate light annoyances if provided
  if (ratingData.lightAnnoyances && Array.isArray(ratingData.lightAnnoyances)) {
    const validAnnoyances = ['ac-panel', 'telephone', 'tv-dot', 'corridor-light', 'curtain-window', 'smoke-alarm'];
    const invalidAnnoyances = ratingData.lightAnnoyances.filter(annoyance => !validAnnoyances.includes(annoyance));
    
    if (invalidAnnoyances.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid light annoyances provided', 
        invalidValues: invalidAnnoyances,
        validValues: validAnnoyances
      });
    }
  }

  // Validate noise issues if provided
  if (ratingData.noise && Array.isArray(ratingData.noise)) {
    const validNoise = ['street', 'through-walls', 'through-ceiling-floors', 'corridor', 'courtyard', 'parking', 'air-traffic'];
    const invalidNoise = ratingData.noise.filter(noise => !validNoise.includes(noise));
    
    if (invalidNoise.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid noise issues provided', 
        invalidValues: invalidNoise,
        validValues: validNoise
      });
    }
  }

  // Get client IP
  const ipAddress = getClientIP(req);
  console.log(`Rating submission from IP: ${ipAddress}, Fingerprint: ${ratingData.fingerprint}, Hotel: ${ratingData.hotelKey}`);

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
  const ratingFields = ['bedSize', 'bedComfort', 'bedcoverSize', 'bedcoverComfort', 'pillowSize', 'pillowComfort'];
  const hasAtLeastOneRating = ratingFields.some(field => ratingData[field] && ratingData[field].trim() !== '');
  const hasLightAnnoyances = ratingData.lightAnnoyances && ratingData.lightAnnoyances.length > 0;
  const hasNoise = ratingData.noise && ratingData.noise.length > 0;

  if (!hasAtLeastOneRating && !hasLightAnnoyances && !hasNoise) {
    return res.status(400).json({ error: 'At least one rating field, light annoyance, or noise issue must be provided' });
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
      lightAnnoyances: ratingData.lightAnnoyances || [],
      noise: ratingData.noise || [],
      fingerprint: ratingData.fingerprint,
      ipAddress: ipAddress,
      submissionTime: new Date()
    });

    await rating.save();
    
    // Update rate limits after successful save
    await updateRateLimit(ratingData.fingerprint, ratingData.hotelKey, ipAddress);
    
    console.log('Hotel rating saved successfully with noise and light annoyances support');
    res.status(201).json({ message: 'Rating submitted successfully', rating });
  } catch (err) {
    console.error('Error saving rating:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Hotel Bedding Rating Server running on http://localhost:${port}`);
});
