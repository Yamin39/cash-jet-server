const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
    const transactionsCollection = client.db("cashJetDB").collection("transactions");

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
        _id: result?._id,
        name: result?.name,
        mobileNumber: result?.mobileNumber,
        email: result?.email,
        balance: result?.balance,
        role: result?.role,
        status: result?.status,
        isNew: result?.isNew,
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

    // get users
    app.get("/users", verifyToken, async (req, res) => {
      const search = req.query.search;
      const query = {};
      if (search !== "  ") {
        query.name = {
          $regex: search,
          $options: "i",
        };
      }
      const cursor = usersCollection.find(query);
      const result = await cursor.toArray();
      const users = result.filter((user) => user.role !== "admin");
      res.send(users);
    });

    // activate user
    app.patch("/users/activate/:id", verifyToken, async (req, res) => {
      const userId = req.params?.id;
      const { status, isNew, role, balance } = req.body;
      const query = { _id: new ObjectId(userId) };
      const update = { $set: { status } };
      if (isNew) {
        if (role === "user") {
          update.$set.balance = balance + 40;
          update.$set.isNew = false;
        } else if (role === "agent") {
          update.$set.balance = balance + 10000;
          update.$set.isNew = false;
        }
      }
      const result = await usersCollection.updateOne(query, update);
      res.send(result);
    });

    // block user
    app.patch("/users/block/:id", verifyToken, async (req, res) => {
      const userId = req.params?.id;
      const { status } = req.body;
      const query = { _id: new ObjectId(userId) };
      const update = { $set: { status } };
      const result = await usersCollection.updateOne(query, update);
      res.send(result);
    });

    // send cash in request
    app.post("/cash-in-request", verifyToken, async (req, res) => {
      const { email, amount, pin, requestType, timestamp } = req.body;
      const user = await usersCollection.findOne({ email: req.decoded.email });
      const agent = await usersCollection.findOne({ email: email });

      if (!agent || agent?.role !== "agent") {
        res.send({ result: { message: "Invalid agent email", insertedId: null } });
        return;
      }

      if (agent.status !== "activated") {
        res.send({ result: { message: "Agent account is not activated", insertedId: null } });
        return;
      }

      const pinCompare = await bcrypt.compare(pin, user.pin);
      if (!pinCompare) {
        res.send({ result: { message: "Pin is incorrect", insertedId: null } });
        return;
      }

      const request = {
        userId: user?._id,
        agentId: agent?._id,
        userEmail: req.decoded?.email,
        agentEmail: email,
        amount,
        requestType,
        timestamp,
        status: "pending",
      };

      const result = await transactionsCollection.insertOne(request);
      res.send({ result });
    });

    // get pending requests for specific agent
    app.get("/pending-requests", verifyToken, async (req, res) => {
      const query = { agentEmail: req.decoded.email, status: "pending", requestType: req.query.requestType };
      const cursor = transactionsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // reject request
    app.patch("/reject-request/:id", verifyToken, async (req, res) => {
      const transactionId = req.params?.id;
      const { status } = req.body;
      const query = { _id: new ObjectId(transactionId) };
      const update = { $set: { status } };
      const result = await transactionsCollection.updateOne(query, update);
      res.send(result);
    });

    // approve request
    app.patch("/approve-request/:id", verifyToken, async (req, res) => {
      const transactionId = req.params?.id;
      const { status, amount, userId, agentId, requestType } = req.body;

      const query = { _id: new ObjectId(transactionId) };
      const update = { $set: { status } };

      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      const agent = await usersCollection.findOne({ _id: new ObjectId(agentId) });

      if (requestType === "cashIn" && agent.balance < amount) {
        res.send({ result: { message: "Agent balance is less than amount", modifiedCount: null } });
        return;
      } else if (requestType === "cashOut" && user.balance < amount) {
        res.send({ result: { message: "User balance is less than amount", modifiedCount: null } });
        return;
      }

      if (requestType === "cashIn") {
        const userUpdate = { $set: { balance: user.balance + amount } };
        const agentUpdate = { $set: { balance: agent.balance - amount } };
        await usersCollection.updateOne({ _id: new ObjectId(userId) }, userUpdate);
        await usersCollection.updateOne({ _id: new ObjectId(agentId) }, agentUpdate);
      } else if (requestType === "cashOut") {
        const userUpdate = { $set: { balance: user.balance - amount } };
        const agentUpdate = { $set: { balance: agent.balance + amount } };
        await usersCollection.updateOne({ _id: new ObjectId(userId) }, userUpdate);
        await usersCollection.updateOne({ _id: new ObjectId(agentId) }, agentUpdate);
      }

      const result = await transactionsCollection.updateOne(query, update);
      res.send({ result });
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
