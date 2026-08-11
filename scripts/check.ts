Promise.all([import("../src/index"), import("../src/client")])
  .then(() => {
    console.log("ok");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
