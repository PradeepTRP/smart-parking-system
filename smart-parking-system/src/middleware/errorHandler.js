/**
 * Centralized Error Handling Middleware for Express & Vercel Serverless
 */
module.exports = (err, req, res, next) => {
    console.error('API Error:', err.message || err);

    const statusCode = err.statusCode || 500;
    let userMessage = err.message || 'Internal Server Error';

    // Helpful message if Supabase is unconfigured
    if (userMessage.includes('Supabase is not configured')) {
        userMessage = 'Database configuration missing. Please add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your environment variables.';
    }

    res.status(statusCode).json({
        success: false,
        error: true,
        message: userMessage,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};
