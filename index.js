require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

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

const verifyJWT = (req, res, next) => {
    // console.log('headers in the middleware: ', req.headers);
    const token = req?.headers?.authorization?.split(" ")[1];

    if (!token)
        return res
            .status(401)
            .send({ message: "Unauthorized Access! caught." });

    jwt.verify(token, process.env.JWT_SECRET_KEY, (error, decoded) => {
        if (error) {
            console.log(error);
            return res.status(401).send({ message: "Unauthorized Access!!!" });
        }
        req.tokenEmail = decoded.email;
        next();
    });
};

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db("marketTrackDB");
        const productCollection = db.collection("products");
        const paymentsCollection = db.collection("payments");
        const usersCollection = db.collection("users");
        const watchlistCollection = db.collection("watchlist");

        const verifyAdmin = async (req, res, next) => {
            const email = req.tokenEmail;
            if (!email) {
                return res
                    .status(403)
                    .send({ message: "Forbidden access - no email found" });
            }

            const user = await usersCollection.findOne({ email });

            if (!user || user.role !== "admin") {
                return res
                    .status(403)
                    .send({ message: "Forbidden access - not admin" });
            }

            next();
        };

        app.post("/jwt", (req, res) => {
            const user = { email: req.body.email };

            const token = jwt.sign(user, process.env.JWT_SECRET_KEY, {
                expiresIn: "14d",
            });
            res.send({ token, message: "JWT created Successfully!" });
        });

        /////////////////// PRODUCT related APIs //////////////////////////
        app.get("/allProduct", async (req, res) => {
            const products = await productCollection.find().toArray();
            res.send(products);
        });

        // specific product
        app.get("/products/:id", async (req, res) => {
            const id = req.params.id;
            // console.log('req.params = ', req.params.id);

            const filter = { _id: new ObjectId(id) };
            const product = await productCollection.findOne(filter);
            res.send(product);
        });

        app.get("/products/sort/low", async (req, res) => {
            try {
                const products = await productCollection
                    .find()
                    .sort({ price: 1 })
                    .toArray();
                res.send(products);
            } catch (error) {
                res.status(500).send({ message: "Failed to sort low to High" });
            }
        });

        app.get("/products/sort/high", async (req, res) => {
            try {
                const products = await productCollection
                    .find()
                    .sort({ price: -1 })
                    .toArray();
                res.send(products);
            } catch (error) {
                res.status(500).send({ message: "Failed to sort High to Low" });
            }
        });
         

        app.get('/products/sort/dateBy', async (req, res)=>{
            try{
                const { startDate, endDate } = req.query;

                if(!startDate || !endDate) {
                    return res.status(400).send({message: "Start date and End date are required"});
                }

                const allProduct = await productCollection.find().toArray();

                const filteredProducts = allProduct.filter((singleProduct) => {
                    if(!Array.isArray(singleProduct.prices)) return false;

                    return singleProduct.prices.some(pricesEntry => {
                        const entryDate = pricesEntry.date;
                        return entryDate >= startDate && entryDate <= endDate;
                    });
                });

                res.send(filteredProducts);
            }

            catch (error){
                console.log('Error in products sorting dateby: ', error);
                res.status(500).send({message: 'Server Error'});
            }
        });

        // my products
        app.get("/products", verifyJWT, async (req, res) => {
            try {
                const decodedEmail = req.tokenEmail;
                const vendorEmail = req?.query?.email;

                // console.log('decoded email ----> ', decodedEmail);
                // console.log('query email -------> ', vendorEmail);

                if (decodedEmail !== vendorEmail) {
                    return res
                        .status(403)
                        .send({ message: "Forbidden Access!" });
                }

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

        app.put("/updateProduct/:id", async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            const product = await productCollection.findOne({
                _id: new ObjectId(id),
            });
            if (!product) {
                return res.status(404).send({ message: "Product not found" });
            }

            const newPrices = product.prices || [];
            newPrices.push({
                date: updatedData.date,
                price: updatedData.price,
            });

            newPrices.sort((a, b) => new Date(a.date) - new Date(b.date));
            const latestPrice = newPrices[newPrices.length - 1].price;

            const updatedProduct = {
                ...updatedData,
                price: latestPrice,
                prices: newPrices,
            };

            const result = await productCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: updatedProduct,
                }
            );

            res.send(result);
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
        // get payment history for specific user and all payment history for admin
        app.get("/payments", verifyJWT, async (req, res) => {
            try {
                const userEmail = req.query.email;
                const decodedEmail = req.tokenEmail;

                // console.log('user email ------> ', userEmail);
                // console.log('decoded email ----> ', decodedEmail);

                if (decodedEmail !== userEmail) {
                    return res
                        .status(403)
                        .send({ message: "Forbidden Access!" });
                }

                const query = userEmail ? { email: userEmail } : {};
                const options = { sort: { paidAt: -1 } };

                const payments = await paymentsCollection
                    .find(query, options)
                    .toArray();
                res.send(payments);
            } catch (error) {
                console.error("Error fetching payment history: ", error);
                res.status(500).send({ message: "Failed to get payments." });
            }
        });

        app.post("/create-payment-intent", async (req, res) => {
            const amountInCents = req.body.amountInCents;
            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents,
                    currency: "usd",
                    payment_method_types: ["card"],
                });
                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        app.post("/payments", async (req, res) => {
            try {
                const {
                    productId,
                    productName,
                    email,
                    amount,
                    paymentMethod,
                    transactionId,
                } = req.body;

                const paymentDoc = {
                    productId,
                    productName,
                    email,
                    amount,
                    paymentMethod,
                    transactionId,
                    paidAt: new Date().toISOString(),
                };
                const paymentResult = await paymentsCollection.insertOne(
                    paymentDoc
                );
                res.status(201).send({
                    message: "Payment recodrded to db successfully!",
                    insertedId: paymentResult.insertedId,
                });
            } catch (error) {
                console.error("Payment processing failed : ", error);
            }
        });

        ////////////////////// USER related APIs //////////////////////

        app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
            const allUser = await usersCollection.find().toArray();
            res.send(allUser);
        });

        // specific user
        app.get("/users/:email", async (req, res) => {
            const email = req.params.email;

            const filter = { email : email };
            const singleUser = await usersCollection.findOne(filter);
            res.send(singleUser);
        });

        // getting user role by email
        app.get("/user/role/:email", async (req, res) => {
            try {
                const email = req.params.email;
                const user = await usersCollection.findOne({ email });

                if (!user) {
                    return res
                        .status(404)
                        .send({ role: null, message: "User not found" });
                }

                res.send({ role: user.role });
            } catch (error) {
                console.log("Error fetching role: ", error);
                res.status(500).send({
                    role: null,
                    error: "Internal Server Error",
                });
            }
        });

        app.post("/users", async (req, res) => {
            const email = req.body.email;
            const userExist = await usersCollection.findOne({ email });

            if (userExist) {
                return res
                    .status(200)
                    .send({ message: "User already exists.", inserted: false });
            } else {
                const user = req.body;
                const result = await usersCollection.insertOne(user);
                res.send(result);
            }
        });

        app.patch(
            "/users/role/:id",
            verifyJWT,
            verifyAdmin,
            async (req, res) => {
                const userId = req.params.id;
                const { newRole } = req.body;

                try {
                    const result = await usersCollection.updateOne(
                        { _id: new ObjectId(userId) },
                        { $set: { role: newRole } }
                    );
                    if (result.modifiedCount > 0) {
                        res.send({
                            success: true,
                            modifiedCount: result.modifiedCount,
                        });
                    } else {
                        res.send({
                            success: false,
                            message: "No changes made",
                        });
                    }
                } catch (error) {
                    console.error("Update error:", error);
                    res.status(500).send({
                        success: false,
                        message: "Failed to update role",
                    });
                }
            }
        );


        /////////////////////// WATCHLIST related APIs ///////////////////////
        app.get("/watchlist", async (req, res) => {
            const watchlistItems = await watchlistCollection.find().toArray();
            res.send(watchlistItems);
        });

        // user specific watchlist
        app.get("/myWatchlist", async(req, res)=>{
            try{
                const userEmail = req.query.email;

                if(!userEmail) {
                    return res.status(400).send({message: "Email is required to query!"});
                }

                const query = { email: userEmail };

                const result = await watchlistCollection.find(query).toArray();

                res.send(result);
            }

            catch(error){
                console.log('Failed to fetch watchlist items: ', error);
                res.status(500).send({message: 'Internal Server Error'});
            }
        })

        app.get("/watchlist/check", async(req, res)=>{
            try{
                const {email, productId} = req.query;
                const isExist = await watchlistCollection.findOne({ email, productId});
                res.send({ exist : !!isExist});
            }   
            catch(error){
                console.log(error);
                res.status(500).send({message: "Internal Server Error"});
            }
        });

        app.post("/watchlist", async (req, res) => {
            try {
                const newWatchlistObj = req.body;
                const result = await watchlistCollection.insertOne(newWatchlistObj);
                res.send(result);
            } catch (error) {
                console.log("Failed to save product to db : ", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });


        app.delete("/watchlist/:id", async(req, res)=>{
            const id = req.params.id;

            try{
                const result = await watchlistCollection.deleteOne({ _id: new ObjectId(id) });

                if(result.deletedCount > 0) {
                    // console.log(result);
                    res.send({ success: true, result: result });
                }
                else{
                    res.status(404).send({message : "Item not found"});
                }
            }
            catch(error){
                res.status(500).send({message: "Internal Server Error!"});
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
