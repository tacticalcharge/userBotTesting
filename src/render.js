import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.get("/", (_request, response) => {
  response.send("Hello world!");
});

app.listen(port, () => {
  console.log(`Website listening at http://localhost:${port}`);
});
