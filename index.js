require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY)

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.j4wv0oh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

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

        const db = client.db("marketTrackDB");
        const productCollection = db.collection("products");

        /////////////////// PRODUCT related APIs //////////////////////////
        app.get("/allProduct", async (req, res) => {
            const products = await productCollection.find().toArray();
            res.send(products);
        });


        // specific product
        app.get('/products/:id', async(req, res)=>{
            const id = req.params.id;
            // console.log('req.params = ', req.params.id);
            
            const filter = {_id: new ObjectId(id)}
            const product = await productCollection.findOne(filter);
            res.send(product);
        })

        // my product
        app.get("/products", async (req, res) => {
            try {
                const vendorEmail = req.query.email;

                const query = { email: vendorEmail };
                const options = {
                    sort: { date: -1 },
                };

                const myProducts = await productCollection
                    .find(query, options)
                    .toArray();
                res.send(myProducts);
            } catch (error) {
                console.error("Error fetching products : ", error);
                res.status(500).send({ message: "Failed to get products" });
            }
        });

        app.post("/addProduct", async (req, res) => {
            try {
                const newProduct = req.body;
                const result = await productCollection.insertOne(newProduct);
                res.send(result);
            } catch (error) {
                console.log("Failed to save product to db : ", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

        app.delete("/products/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await productCollection.deleteOne({
                    _id: new ObjectId(id),
                });
                res.send(result);
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Server error",
                });
            }
        });



        ////////////////////// PAYMENT related APIs ////////////////////////
        app.post('/create-payment-intent', async(req, res)=>{
            const amountInCents = req.body.amountInCents;
            try{
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents,
                    currency: 'usd',
                    payment_method_types: ['card'],
                });
                res.json({ clientSecret: paymentIntent.client_secret })
            }
            catch (error){
                res.status(500).json({error: error.message});
            }
        })

















        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log(
            "Pinged your deployment. You successfully connected to MongoDB!"
        );
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("MarketTrack server is running");
});

app.listen(port, () => {
    console.log(`MarketTrack Server is Running on Port ${port}`);
});
