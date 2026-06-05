const url =
  "https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?t=Spain";

const response = await fetch(url);

console.log("Status:", response.status);

const text = await response.text();

console.log("Length:", text.length);
console.log("Body:", JSON.stringify(text));