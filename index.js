import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import pg from "pg";
import session from "express-session";
import passport from "passport";
import env from "dotenv";
import bcrypt from "bcrypt";
import otpGenerator from "otp-generator";
import nodemailer from "nodemailer";

// Load environment variables
env.config();

const app = express();
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 3 * 60 * 60 * 1000 },
  })
);
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, cb) => {
  if (user.redirectUrl) {
    return cb(null, user.redirectUrl);
  } else if (user.redirectToSignin) {
    return cb(null, "/signin");
  } else {
    return cb(null, user);
  }
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

// Signup route
app.post("/signup", async (req, res) => {
  const { firstname, lastname, email, password } = req.body;

  try {
    // Encrypt the password
    const hashedPassword = await bcrypt.hash(password, 3);

    const values = [firstname, lastname, email, hashedPassword];
    const sql =
      "INSERT INTO users (firstname, lastname, email, password) VALUES ($1, $2, $3, $4)";

    db.query(sql, values, (err, result) => {
      if (err) {
        console.error("Error executing SQL query:", err);
        return res
          .status(500)
          .json({ error: "An error occurred while saving data." });
      }
      console.log("Rows affected:", result.rowCount);
      console.log("Data inserted successfully:", result.rows);
      return res.status(200).json({ success: true });
    });
  } catch (err) {
    console.error("Error encrypting password:", err);
    return res
      .status(500)
      .json({ error: "An error occurred while encrypting password." });
  }
});

// Signin route
app.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  console.log("Received data:", req.body);

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    console.log(result.rows);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      console.log(user);
      const hashedPassword = user.password;

      // Compare the encrypted password
      const match = await bcrypt.compare(password, hashedPassword);

      if (match) {
        res.json({ firstName: user.firstname });
        console.log("Successful Login");
      } else {
        res.send("Incorrect Password");
        console.log("Incorrect Password");
      }
    } else {
      res.send("User not found");
      console.log("User not found");
    }
  } catch (err) {
    console.log(err);
    res
      .status(500)
      .json({ error: "An error occurred while processing the request." });
  }
});

// Update password route
app.post("/updatepassword", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Encrypt the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.query(
      "UPDATE users SET password = $1 WHERE email = $2",
      [hashedPassword, email]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error updating password:", err);
    return res
      .status(500)
      .json({ error: "An error occurred while updating password" });
  }
});

app.post("/api/addEmployee", async (req, res) => {
  try {
    const { firstName, lastName, email, phoneNumber, position } = req.body;

    console.log(req.body);

    const query =
      "INSERT INTO employee (first_name, last_name, email, phone_number, position) VALUES ($1, $2, $3, $4, $5)";
    await db.query(query, [firstName, lastName, email, phoneNumber, position]);
    res.status(201).json({ message: "Employee added successfully" });
  } catch (error) {
    console.error("Error adding employee:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/employees", async (req, res) => {
  try {
    const { firstName } = req.query;
    const query = "SELECT * FROM employee WHERE first_name = $1";
    const result = await db.query(query, [firstName]);
    console.log(result);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: "Employee not found" });
    }
  } catch (error) {
    console.error("Error fetching employee data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// OTP generation and sending route
const otpStore = {};

app.post("/generate-otp", async (req, res) => {
  const { email } = req.body;

  const otp = otpGenerator.generate(6, {
    digits: true,
    alphabets: false,
    upperCase: false,
    specialChars: true,
  });
  try {
    // Store the OTP in the temporary store
    otpStore[email] = otp;
    console.log("from generate-otp " + otpStore[email]);

    // Send OTP via email (replace with your email sending logic)
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.APP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: "OTP Verification",
      text: `Your OTP for verification is: ${otp}`,
    });

    res.status(200).send("OTP sent successfully");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error sending OTP");
  }
});

// OTP verification route
app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  console.log("from verify side " + otpStore[email]);
  try {
    if (otpStore[email] && otpStore[email] === otp) {
      delete otpStore[email];
      res.status(200).send("OTP verified successfully");
    } else {
      res.status(400).send("Invalid OTP");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Error verifying OTP");
  }
});

// Homepage route
app.get("/Homepage", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: req.user });
  } else {
    res.status(401).json({ error: "You are not logged in" });
  }
});

// Listen on port 4000
const port = 4000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
