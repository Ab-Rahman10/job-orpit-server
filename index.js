const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const port = process.env.PORT || 9000;
const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).send({ message: "Unauthorized access" });
  jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized access" });
    }
    req.user = decoded;

    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.euk0j.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

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
    const db = client.db("soloDB");
    const jobCollection = db.collection("jobs");
    const bidJobCollection = db.collection("bidJobs");

    // generate jwt
    app.post("/jwt", async (req, res) => {
      const email = req.body;

      // create token
      const token = jwt.sign(email, process.env.SECRET_KEY, {
        expiresIn: "365ds",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    app.get("/jwt-logout", async (req, res) => {
      res
        .clearCookie("token", {
          maxAge: 0,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // job related APIs
    app.get("/jobs", async (req, res) => {
      const result = await jobCollection.find().toArray();
      res.send(result);
    });

    app.post("/add-jobs", async (req, res) => {
      const job = req.body;
      const result = await jobCollection.insertOne(job);
      res.send(result);
    });

    app.get("/jobs/:email", async (req, res) => {
      const email = req.params.email;
      const filter = { "buyer.email": email };
      const result = await jobCollection.find(filter).toArray();
      res.send(result);
    });

    app.delete("/job/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobCollection.deleteOne(query);
      res.send(result);
    });

    // get a specific job by id
    app.get("/job/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await jobCollection.findOne(filter);
      res.send(result);
    });

    // update the job
    app.put("/update-job/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const jobData = req.body;
      const updatedData = {
        $set: jobData,
      };
      const option = { upsert: true };
      const result = await jobCollection.updateOne(filter, updatedData, option);
      res.send(result);
    });

    // bid jobs APIs
    app.post("/add-bidJob", async (req, res) => {
      const bidJob = req.body;

      // If a user placed a bid on this job
      const filter = { email: bidJob.email, jobId: bidJob.jobId };
      const alreadyExist = await bidJobCollection.findOne(filter);
      if (alreadyExist)
        return res
          .status(400)
          .send("You have already placed a bid on this job");

      const result = await bidJobCollection.insertOne(bidJob);

      // update bid count
      const query = { _id: new ObjectId(bidJob.jobId) };
      const update = {
        $inc: {
          bid_count: 1,
        },
      };
      await jobCollection.updateOne(query, update);
      res.send(result);
    });

    // get data for a specific user & get bid request data
    app.get("/bid-jobs/:email", verifyToken, async (req, res) => {
      const isBuyer = req.query.buyer;
      const email = req.params.email;

      // check whether the token is valid or not
      const decodedEmail = req.user?.email;
      console.log("Decoded email-->", decodedEmail);

      if (decodedEmail !== email) {
        return res.status(403).send({ message: "Unauthorized access" });
      }

      let query = {};
      if (isBuyer) {
        query.buyer = email;
      } else {
        query.email = email;
      }
      const result = await bidJobCollection.find(query).toArray();
      res.send(result);
    });

    // get all jobs
    app.get("/all-jobs", async (req, res) => {
      const filter = req.query.filter;
      const search = req.query.search;
      const sort = req.query.sort;
      let options = {};
      if (sort) {
        options = { sort: { deadline: sort === "asc" ? 1 : -1 } };
      }
      let query = {
        title: {
          $regex: search,
          $options: "i",
        },
      };
      if (filter) {
        query.category = filter;
      }
      const result = await jobCollection.find(query, options).toArray();
      res.send(result);
    });

    // --------- It is an alternative option to the above API. -------------

    // // get data for a specific user

    // app.get("/bid-jobs/:email", async (req, res) => {
    //   const email = req.params.email;
    //   const query = { email };
    //   const result = await bidJobCollection.find(query).toArray();
    //   res.send(result);
    // });

    // // get bid request data

    // app.get("/bid-request/:email", async (req, res) => {
    //   const email = req.params.email;
    //   const query = { buyer: email };
    //   const result = await bidJobCollection.find(query).toArray();
    //   res.send(result);
    // });

    app.patch("/bid-status-update/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const update = {
        $set: {
          status,
        },
      };
      const result = await bidJobCollection.updateOne(filter, update);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("Hello from jobOrpit Server....");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
