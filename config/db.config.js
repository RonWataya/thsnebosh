require('dotenv').config();
const HOST = 'localhost';
const USER = 'root';
const PASSWORD = '';
const DB = 'omnipos';
const PORTAWS = '';

module.exports = {
    HOST: HOST,
    USER: USER,
    PASSWORD: PASSWORD,
    DB: DB
        //  PORTAWS: PORTAWS
};

/*const HOST = 'tests.cnm0ouk4axh4.us-east-1.rds.amazonaws.com';
const USER = 'admin';
const PASSWORD = 'wataya1993';
const DB = 'omnipos';
const PORTAWS = '3306';
/*
const HOST = 'tests.cnm0ouk4axh4.us-east-1.rds.amazonaws.com';
const USER = 'admin';
const PASSWORD = 'wataya1993';
const DB = 'miwallet_customers';
const PORTAWS = '3306';

**local**
const HOST = 'localhost';
const USER = 'root';
const PASSWORD = '1234';
const DB = 'miwallet_customers';
const PORTAWS = '';
module.exports = {
    HOST: HOST,
    USER: USER,
    PASSWORD: PASSWORD,
    DB: DB,
    PORTAWS: PORTAWS
};*/