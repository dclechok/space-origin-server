const jwt = require("jsonwebtoken");

module.exports = function generateToken(userOrId, username, email) {
  let payload;

  // Case 1: full user object passed in (user._id, user.username, user.email)
  if (typeof userOrId === "object" && userOrId._id) {
    payload = {
      id: userOrId._id.toString(),
      username: userOrId.username,
      email: userOrId.email,
    };
  }
  // Case 2: ID + username + email passed individually
  else {
    payload = {
      id: userOrId.toString(),
      username,
      email,
    };
  }

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};
