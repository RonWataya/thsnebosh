const mysql = require("mysql2");
const dbConfig = require("./db.config.js");
// Create a connection to the database
const connection = mysql.createPool({
    connectionLimit: 1000,
    host: dbConfig.HOST,
    user: dbConfig.USER,
    password: dbConfig.PASSWORD,
    database: dbConfig.DB,
    port: dbConfig.PORTAWS,
    waitForConnections: true,
    queueLimit: 0
        //port: dbConfig.PORTAWS
});
// open the MySQL connection
connection.getConnection(function(error, connection) {
    if (error) throw error;
    console.log("Successfully connected to the database.");
});
module.exports = connection;