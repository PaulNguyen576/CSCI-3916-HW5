const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const mongoose = require('mongoose');
const passport = require('passport');
const authJwtController = require('./auth_jwt'); // You're not using authController, consider removing it
const jwt = require('jsonwebtoken');
const cors = require('cors');
const User = require('./Users');
const Movie = require('./Movies'); // You're not using Movie, consider removing it
const Review = require('./Reviews');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(passport.initialize());

const router = express.Router();
const GA_TRACKING_ID = process.env.GA_KEY;
const GA_API_SECRET = process.env.GA_SECRET;
const GA_DEBUG = String(process.env.GA_DEBUG).toLowerCase() === 'true';

const shouldIncludeReviews = (req) => String(req.query.reviews).toLowerCase() === 'true';

async function sendRequest({ method, url, qs, body, headers }) {
  const requestUrl = new URL(url);

  if (qs) {
    Object.entries(qs).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        requestUrl.searchParams.append(key, String(value));
      }
    });
  }

  const requestHeaders = { ...(headers || {}) };
  const options = {
    method,
    headers: requestHeaders
  };

  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(requestUrl.toString(), options);
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Analytics request failed with status ${response.status}`);
  }

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch (_err) {
    return responseText;
  }
}

async function trackDimension(category, action, label, value, dimension, metric) {
  if (!GA_TRACKING_ID) {
    return;
  }

  // GA4 (G-XXXX) path using Measurement Protocol with api_secret.
  if (GA_TRACKING_ID.startsWith('G-') && GA_API_SECRET) {
    const sessionId = String(Math.floor(Date.now() / 1000));
    const ga4Url = GA_DEBUG
      ? 'https://www.google-analytics.com/debug/mp/collect'
      : 'https://www.google-analytics.com/mp/collect';

    const ga4Options = {
      method: 'POST',
      url: ga4Url,
      qs: {
        measurement_id: GA_TRACKING_ID,
        api_secret: GA_API_SECRET
      },
      json: true,
      body: {
        client_id: crypto.randomBytes(16).toString('hex'),
        events: [
          {
            name: 'movie_review_request',
            params: {
              session_id: sessionId,
              engagement_time_msec: 100,
              event_category: category,
              event_action: action,
              event_label: label,
              value: Number(value),
              movie_name: dimension,
              requested: Number(metric)
            }
          }
        ]
      },
      headers: {
        'Cache-Control': 'no-cache'
      }
    };

    const ga4Response = await sendRequest(ga4Options);

    if (GA_DEBUG && ga4Response && Array.isArray(ga4Response.validationMessages) && ga4Response.validationMessages.length > 0) {
      console.error('GA debug validation messages:', ga4Response.validationMessages);
    }

    return ga4Response;
  }

  // Legacy UA path (assignment sample format).
  const uaOptions = {
    method: 'GET',
    url: 'https://www.google-analytics.com/collect',
    qs: {
      // API Version.
      v: '1',
      // Tracking ID / Property ID.
      tid: GA_TRACKING_ID,
      // Random Client Identifier.
      cid: crypto.randomBytes(16).toString('hex'),
      // Event hit type.
      t: 'event',
      // Event category/action/label/value.
      ec: category,
      ea: action,
      el: label,
      ev: value,
      // Custom Dimension and Metric.
      cd1: dimension,
      cm1: metric
    },
    headers: {
      'Cache-Control': 'no-cache'
    }
  };

  return sendRequest(uaOptions);
}

router.get('/', async (req, res) => {
  try {
    await trackDimension('Traffic', 'get /', 'Render Root Visit', '1', '/', '1');
  } catch (err) {
    console.error('Analytics tracking error:', err.message || err);
  }

  res.status(200).json({ success: true, message: 'Movie Reviews API is running.' });
});

// Removed getJSONObjectForMovieRequirement as it's not used

router.post('/signup', async (req, res) => { // Use async/await
  if (!req.body.username || !req.body.password) {
    return res.status(400).json({ success: false, msg: 'Please include both username and password to signup.' }); // 400 Bad Request
  }

  try {
    const user = new User({ // Create user directly with the data
      name: req.body.name,
      username: req.body.username,
      password: req.body.password,
    });

    await user.save(); // Use await with user.save()

    res.status(201).json({ success: true, msg: 'Successfully created new user.' }); // 201 Created
  } catch (err) {
    if (err.code === 11000) { // Strict equality check (===)
      return res.status(409).json({ success: false, message: 'A user with that username already exists.' }); // 409 Conflict
    } else {
      console.error(err); // Log the error for debugging
      return res.status(500).json({ success: false, message: 'Something went wrong. Please try again later.' }); // 500 Internal Server Error
    }
  }
});


router.post('/signin', async (req, res) => { // Use async/await
  try {
    const user = await User.findOne({ username: req.body.username }).select('name username password');

    if (!user) {
      return res.status(401).json({ success: false, msg: 'Authentication failed. User not found.' }); // 401 Unauthorized
    }

    const isMatch = await user.comparePassword(req.body.password); // Use await

    if (isMatch) {
      const userToken = { id: user._id, username: user.username }; // Use user._id (standard Mongoose)
      const token = jwt.sign(userToken, process.env.SECRET_KEY, { expiresIn: '1h' }); // Add expiry to the token (e.g., 1 hour)
      res.json({ success: true, token: 'JWT ' + token });
    } else {
      res.status(401).json({ success: false, msg: 'Authentication failed. Incorrect password.' }); // 401 Unauthorized
    }
  } catch (err) {
    console.error(err); // Log the error
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again later.' }); // 500 Internal Server Error
  }
});

router.route('/movies')
  .get(authJwtController.isAuthenticated, async (req, res) => {
    try {
      let movies;

      if (shouldIncludeReviews(req)) {
        movies = await Movie.aggregate([
          {
            $lookup: {
              from: 'reviews',
              localField: '_id',
              foreignField: 'movieId',
              as: 'reviews'
            }
          },
          {
            $addFields: {
              avgRating: {
                $ifNull: [{ $avg: '$reviews.rating' }, 0]
              }
            }
          },
          {
            $sort: {
              avgRating: -1
            }
          }
        ]);
      } else {
        movies = await Movie.find();
      }

      res.status(200).json({ success: true, movies });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Error retrieving movies.' });
    }
  })
  .post(authJwtController.isAuthenticated, async (req, res) => {
    try {
      const movie = new Movie({
        title: req.body.title,
        releaseDate: req.body.releaseDate,
        genre: req.body.genre,
        actors: req.body.actors,
      });
      await movie.save();
      res.status(201).json({ success: true, msg: 'Movie successfully added.', movie });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Error saving movie.' });
    }
  })
  .put(authJwtController.isAuthenticated, (req, res) => {
    res.status(405).json({ success: false, message: 'PUT not supported on /movies. Use /movies/:movieparameter.' });
  })
  .delete(authJwtController.isAuthenticated, (req, res) => {
    res.status(405).json({ success: false, message: 'DELETE not supported on /movies. Use /movies/:movieparameter.' });
  });

router.route('/movies/:movieparameter')
  .get(authJwtController.isAuthenticated, async (req, res) => {
    try {
      let movie;

      if (shouldIncludeReviews(req)) {
        const moviesWithReviews = await Movie.aggregate([
          {
            $match: {
              title: req.params.movieparameter
            }
          },
          {
            $lookup: {
              from: 'reviews',
              localField: '_id',
              foreignField: 'movieId',
              as: 'reviews'
            }
          },
          {
            $addFields: {
              avgRating: {
                $ifNull: [{ $avg: '$reviews.rating' }, 0]
              }
            }
          }
        ]);
        movie = moviesWithReviews[0];
      } else {
        movie = await Movie.findOne({ title: req.params.movieparameter });
      }

      if (!movie) return res.status(404).json({ success: false, message: 'Movie not found.' });
      res.status(200).json({ success: true, movie });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Error retrieving movie.' });
    }
  })
  .post(authJwtController.isAuthenticated, (req, res) => {
    res.status(405).json({ success: false, message: 'POST not supported on /movies/:movieparameter. Use /movies.' });
  })
  .put(authJwtController.isAuthenticated, async (req, res) => {
    try {
      const updatedMovie = await Movie.findOneAndUpdate(
        { title: req.params.movieparameter },
        { title: req.body.title, releaseDate: req.body.releaseDate, genre: req.body.genre, actors: req.body.actors },
        { new: true, runValidators: true }
      );
      if (!updatedMovie) return res.status(404).json({ success: false, message: 'Movie not found.' });
      res.status(200).json({ success: true, msg: 'Movie successfully updated.', movie: updatedMovie });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Error updating movie.' });
    }
  })
  .delete(authJwtController.isAuthenticated, async (req, res) => {
    try {
      const deletedMovie = await Movie.findOneAndDelete({ title: req.params.movieparameter });
      if (!deletedMovie) return res.status(404).json({ success: false, message: 'Movie not found.' });
      res.status(200).json({ success: true, msg: 'Movie successfully deleted.', movie: deletedMovie });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Error deleting movie.' });
    }
  });

router.route('/reviews')
  .get(async (req, res) => {
    try {
      const filter = {};
      if (req.query.movieId) {
        filter.movieId = req.query.movieId;
      }

      const reviews = await Review.find(filter);
      res.status(200).json({ success: true, reviews });
    } catch (err) {
      console.error(err);
      if (err.name === 'CastError') {
        return res.status(400).json({ success: false, message: 'Invalid movieId.' });
      }
      res.status(500).json({ success: false, message: 'Error retrieving reviews.' });
    }
  })
  .post(authJwtController.isAuthenticated, async (req, res) => {
    try {
      const { movieId, review, rating } = req.body;

      if (!movieId || review === undefined || rating === undefined) {
        return res.status(400).json({ success: false, message: 'movieId, review, and rating are required.' });
      }

      const movie = await Movie.findById(movieId);
      if (!movie) {
        return res.status(404).json({ success: false, message: 'Movie not found.' });
      }

      const newReview = new Review({
        movieId: new mongoose.Types.ObjectId(req.body.movieId),
        username: req.user.username,
        review,
        rating
      });

      await newReview.save();

      // Track review API request for analytics policy.
      trackDimension(
        movie.genre || 'Unknown',
        `${req.method.toLowerCase()} ${req.path}`,
        'API Request for Movie Review',
        '1',
        movie.title,
        '1'
      ).catch((analyticsErr) => {
        console.error('Analytics tracking error:', analyticsErr.message || analyticsErr);
      });

      res.status(201).json({ message: 'Review created!' });
    } catch (err) {
      console.error(err);
      if (err.name === 'CastError' || err.name === 'ValidationError') {
        return res.status(400).json({ success: false, message: 'Invalid review payload.' });
      }
      res.status(500).json({ success: false, message: 'Error creating review.' });
    }
  })
  .put(authJwtController.isAuthenticated, (req, res) => {
    res.status(405).json({ success: false, message: 'PUT not supported on /reviews.' });
  })
  .delete(authJwtController.isAuthenticated, (req, res) => {
    res.status(405).json({ success: false, message: 'DELETE not supported on /reviews.' });
  });

router.route('/test')
  .get(async (req, res) => {
    try {
      await trackDimension('Feedback', 'Rating', 'Feedback for Movie', '3', 'Guardians of the Galaxy 2', '1');
      res.status(200).send('Event tracked.').end();
    } catch (err) {
      console.error(err);
      res.status(500).send('Event tracking failed.').end();
    }
  });

app.use('/', router);

const PORT = process.env.PORT || 8081; // Define PORT before using it
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app; // for testing only