const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const errorMiddleware = require("../middleware/error");

const run = (err) => {
  const response = {};
  const resp = {
    status(code) { response.status = code; return this; },
    json(body) { response.body = body; return this; },
  };
  errorMiddleware(err, {}, resp, () => {});
  return response;
};

const errorFrom = (verify) => {
  try {
    verify();
  } catch (error) {
    return error;
  }
  throw new Error("expected jwt.verify to throw");
};

test("an expired session token answers 401, not 500", () => {
  const expired = jwt.sign({ id: "x", exp: Math.floor(Date.now() / 1000) - 60 }, "secret");
  const { status, body } = run(errorFrom(() => jwt.verify(expired, "secret")));
  assert.equal(status, 401);
  assert.equal(body.success, false);
  assert.match(body.message, /expired/);
});

test("a tampered session token answers 401", () => {
  const token = jwt.sign({ id: "x" }, "secret");
  const { status } = run(errorFrom(() => jwt.verify(token, "other-secret")));
  assert.equal(status, 401);
});

test("unknown errors still answer 500", () => {
  assert.equal(run(new Error("boom")).status, 500);
});
