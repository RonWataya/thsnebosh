require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise'); // Use promise-based API
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '20mb' })); // Increased limit for base64 images
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));
// IMPORTANT: For production, restrict CORS to your frontend domain
app.use(cors()); // Enable CORS for all origins (for development only!)

// Serve static files from the current directory (assuming index.html and app.js are here)
app.use(express.static(__dirname));

// MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'tests.cnm0ouk4axh4.us-east-1.rds.amazonaws.com',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'wataya1993', // Use empty string if no password
    database: process.env.DB_NAME || 'nebosh_attendance', // Using the database name from SQL
    port: parseInt(process.env.DB_PORT) || 3306, // Ensure port is an integer
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test DB connection
pool.getConnection()
    .then(connection => {
        console.log('Connected to MySQL database!');
        connection.release(); // Release the connection back to the pool
    })
    .catch(err => {
        console.error('Error connecting to MySQL:', err.message);
        process.exit(1); // Exit process if cannot connect to DB
    });


// --- API Endpoints ---

// 1. Endpoint to search for learners (for autocomplete) - UNCHANGED
app.get('/api/learners/search', async (req, res) => {
    const query = req.query.query;
    if (!query || query.length < 2) {
        return res.json([]);
    }
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute(
            'SELECT learner_id, learner_name FROM learners WHERE learner_name LIKE ? LIMIT 10',
            [`%${query}%`]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error searching learners:', error);
        res.status(500).json({ message: 'Error searching learners' });
    } finally {
        if (connection) connection.release();
    }
});

// 2. Endpoint to get a single module's attendance status for a learner (MODIFIED)
// This will now fetch based on learnerId and moduleTitle, ignoring attendanceDate for lookup
app.get('/api/attendance/learner-module', async (req, res) => {
    const { learnerId, moduleTitle } = req.query;

    if (!learnerId || !moduleTitle) {
        return res.status(400).json({ message: 'Missing parameters: learnerId, moduleTitle' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.execute(
            `SELECT
                record_id,
                learner_id,
                attendance_date,
                module_title,
                signature1,
                is_signed1,
                signature2,
                is_signed2,
                signature3,
                is_signed3,
                signature4,
                is_signed4
            FROM attendance_records
            WHERE learner_id = ? AND module_title = ?`,
            [learnerId, moduleTitle]
        );
        res.json(rows[0] || {}); // Return first row found, or empty object if none
    } catch (error) {
        console.error('Error fetching learner module attendance:', error);
        res.status(500).json({ message: 'Error fetching attendance status.' });
    } finally {
        if (connection) connection.release();
    }
});


// 3. Endpoint to sign a specific session for a learner/module (MODIFIED)
// It will use module_title as part of the unique record lookup
app.post('/api/sign-session', async (req, res) => {
    const { learnerName, learnerId, attendanceDate, moduleTitle, sessionNum, signatureData } = req.body; // moduleDay removed

    if (!learnerName || !attendanceDate || !moduleTitle || !sessionNum || !signatureData) {
        return res.status(400).json({ message: 'Missing required fields for session signing.' });
    }
    if (sessionNum < 1 || sessionNum > 4) {
        return res.status(400).json({ message: 'Invalid session number. Must be 1, 2, 3, or 4.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction(); // Start a transaction

        let currentLearnerId = learnerId;

        // Step 1: Find or Create Learner (if learnerId is 'NEW') - UNCHANGED
        if (currentLearnerId === 'NEW') {
            const [existingLearners] = await connection.execute(
                'SELECT learner_id FROM learners WHERE learner_name = ?',
                [learnerName]
            );
            if (existingLearners.length > 0) {
                currentLearnerId = existingLearners[0].learner_id; // Use existing ID
            } else {
                const [insertResult] = await connection.execute(
                    'INSERT INTO learners (learner_name) VALUES (?)',
                    [learnerName]
                );
                currentLearnerId = insertResult.insertId; // Get the newly created ID
            }
        } else {
            // Validate if provided learnerId exists (optional but good for data integrity)
            const [existingLearners] = await connection.execute(
                'SELECT learner_id FROM learners WHERE learner_id = ?',
                [currentLearnerId]
            );
            if (existingLearners.length === 0) {
                throw new Error(`Learner with ID ${currentLearnerId} not found. Please re-enter learner name.`);
            }
        }

        // Step 2: Insert or Update Attendance Record for the specific session
        const signatureColumn = `signature${sessionNum}`; // e.g., 'signature1', 'signature2'
        const isSignedColumn = `is_signed${sessionNum}`; // e.g., 'is_signed1', 'is_signed2'

        // Check for an existing record for this learner and module_title (MODIFIED)
        const [existingAttendance] = await connection.execute(
            'SELECT record_id FROM attendance_records WHERE learner_id = ? AND module_title = ?',
            [currentLearnerId, moduleTitle]
        );

        if (existingAttendance.length > 0) {
            // Update existing attendance record for the specific signature and signed status columns
            console.log(`Updating ${signatureColumn} and ${isSignedColumn} for learner ${learnerName} (ID: ${currentLearnerId}) on ${attendanceDate} for ${moduleTitle}`);
            await connection.execute(
                `UPDATE attendance_records SET
                    ${signatureColumn} = ?,
                    ${isSignedColumn} = 1, -- Set to 1 as it's now signed
                    attendance_date = ?, -- Update the attendance_date to the latest sign date
                    submission_timestamp = CURRENT_TIMESTAMP
                WHERE record_id = ?`,
                [
                    signatureData,
                    attendanceDate, // Pass attendanceDate here for update
                    existingAttendance[0].record_id
                ]
            );
        } else {
            // Insert new attendance record. Only the signed session will have data and its flag set.
            console.log(`Inserting new record for learner ${learnerName} (ID: ${currentLearnerId}) on ${attendanceDate} for ${moduleTitle}, session ${sessionNum}`);

            // Prepare values for all 4 signatures and their flags, setting only the current session's
            const signatures = Array(4).fill(null);
            const isSignedFlags = Array(4).fill(0); // All initially 0 (not signed)
            signatures[sessionNum - 1] = signatureData; // Adjust for 0-based array index
            isSignedFlags[sessionNum - 1] = 1; // Set this session's flag to 1

            await connection.execute(
                `INSERT INTO attendance_records
                (learner_id, attendance_date, module_title,
                 signature1, is_signed1, signature2, is_signed2,
                 signature3, is_signed3, signature4, is_signed4)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    currentLearnerId,
                    attendanceDate,
                    moduleTitle,
                    signatures[0], isSignedFlags[0],
                    signatures[1], isSignedFlags[1],
                    signatures[2], isSignedFlags[2],
                    signatures[3], isSignedFlags[3]
                ]
            );
        }

        await connection.commit(); // Commit the transaction
        res.status(201).json({ message: `Session ${sessionNum} signed successfully!`, learnerId: currentLearnerId });

    } catch (error) {
        if (connection) {
            await connection.rollback(); // Rollback on error if anything fails
        }
        console.error('Error signing session:', error);
        res.status(500).json({ message: `Failed to sign session due to a server error: ${error.message}` });
    } finally {
        if (connection) {
            connection.release(); // Always release the connection back to the pool
        }
    }
});


// 4. Endpoint to get all attendance records (for admin dashboard) - MODIFIED FOR GROUPING
app.get('/api/attendance', async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        // Select all relevant columns, including is_signed flags
        const [rows] = await connection.execute(`
            SELECT
                ar.record_id,
                ar.learner_id,
                ar.attendance_date, -- Keeping this to show the last signed date for the module
                ar.module_title,
                ar.signature1, ar.is_signed1,
                ar.signature2, ar.is_signed2,
                ar.signature3, ar.is_signed3,
                ar.signature4, ar.is_signed4,
                ar.submission_timestamp,
                l.learner_name
            FROM
                attendance_records ar
            JOIN
                learners l ON ar.learner_id = l.learner_id
            ORDER BY
                ar.submission_timestamp DESC, ar.attendance_date DESC -- Order by latest submission/attendance date
        `);

        // Group records by unique learner and module title
        const groupedRecords = {};

        rows.forEach(row => {
            // Key based on learner_id and module_title (MODIFIED)
            const key = `${row.learner_id}_${row.module_title}`;

            if (!groupedRecords[key]) {
                groupedRecords[key] = {
                    learnerId: row.learner_id,
                    learnerName: row.learner_name,
                    moduleTitle: row.module_title,
                    // The attendance_date and submission_timestamp here will represent the latest activity
                    attendanceDate: row.attendance_date,
                    submissionTimestamp: row.submission_timestamp,
                    signatures: {}, // Store signature data
                    isSignedStatus: {} // Store is_signed flags
                };
            }
            
            // Populate signatures and isSignedStatus from the current row
            // Since we're grouping by learner_id and module_title, and ordering by timestamp DESC,
            // the first row encountered for a given key will have the most recent data.
            // We just need to ensure all signature and is_signed fields are populated.
            for (let i = 1; i <= 4; i++) {
                groupedRecords[key].signatures[`signature${i}`] = row[`signature${i}`];
                groupedRecords[key].isSignedStatus[`is_signed${i}`] = row[`is_signed${i}`];
            }
            
            // Update submission timestamp and attendance date to the latest for the group
            // This ensures the displayed date reflects the most recent interaction
            if (row.submission_timestamp > groupedRecords[key].submissionTimestamp) {
                groupedRecords[key].submissionTimestamp = row.submission_timestamp;
                groupedRecords[key].attendanceDate = row.attendance_date;
            }
        });

        res.status(200).json(Object.values(groupedRecords)); // Send array of grouped attendance
    } catch (error) {
        console.error('Error fetching attendance records for admin dashboard:', error);
        res.status(500).json({ message: 'Error fetching attendance records.' });
    } finally {
        if (connection) connection.release();
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser to sign attendance.`);
    console.log(`Open http://localhost:${PORT}/admin.html for the admin dashboard.`);
});
