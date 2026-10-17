const cookieOptions = require("./cookieOptions");

const sendToken = (user, statusCode, res) => {
  const token = user.getJWTtoken();

  const options = cookieOptions(new Date(
    Date.now() + process.env.COOKIE_EXPIRE * 24 * 60 * 60 * 1000
  ));

  // The token travels only in the httpOnly cookie, never in the body, so page
  // scripts cannot read it.
  res.status(statusCode).cookie("token", token, options).json({
    success: true,
    user: user.toObject ? user.toObject() : user,
  });
};

module.exports = sendToken;
