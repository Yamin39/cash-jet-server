const { MongoClient, ServerApiVersion } = require("mongodb");
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
require("dotenv").config();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());
const verifyToken = (req, res, next) => {
  console.log("in verify token", req.headers?.authorization);

  if (!req.headers?.authorization) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = req.headers?.authorization?.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
    if (error) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6fu63x8.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("cashJetDB").collection("users");

    // Register user
    app.post("/register", async (req, res) => {
      const user = req.body;
      const isExist = await usersCollection.findOne({ email: user.email });
      if (isExist) {
        res.send({ result: { message: "User already exist", insertedId: null } });
        return;
      }

      const hashedPassword = await bcrypt.hash(user.pin, 10);
      user.pin = hashedPassword;

      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10d",
      });

      const result = await usersCollection.insertOne(user);
      res.send({ result, token });
    });

    // get auth data
    app.get("/auth", verifyToken, async (req, res) => {
      const email = req.decoded.email;
      const query = { email };
      const result = await usersCollection.findOne(query);

      res.send({
        _id: result._id,
        name: result.name,
        mobileNumber: result.mobileNumber,
        email: result.email,
        balance: result.balance,
        role: result.role,
        status: result.status,
      });
    });

    // user login
    app.post("/login", async (req, res) => {
      const pin = req.body.pin;
      const user = await usersCollection.findOne({ email: req.body.email });
      if (!user) {
        res.send({ result: { message: "Email or Pin is wrong", isLogin: false } });
        return;
      }

      const pinCompare = await bcrypt.compare(pin, user.pin);
      if (!pinCompare) {
        res.send({ result: { message: "Email or Pin is wrong", isLogin: false } });
        return;
      }

      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10d",
      });

      res.send({ result: { isLogin: true }, token });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Cash jet server is running");
});

app.listen(port, () => {
  console.log(`Cash jet server is running on port: ${port}`);
});
