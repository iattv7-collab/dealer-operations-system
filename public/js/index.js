const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const ALLOWED_ROLES = ["admin", "manager", "advisor", "wash", "staff", "pending"];

// ---------- helpers ----------
function requireAuth(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }
}

function callerEmail(context) {
  return context.auth?.token?.email || "";
}

function callerRole(context) {
  return context.auth?.token?.role || "pending";
}

function callerActive(context) {
  return context.auth?.token?.active === true;
}

function requireActive(context) {
  if (!callerActive(context)) {
    throw new functions.https.HttpsError("permission-denied", "Account disabled.");
  }
}

function requireRole(context, allowed) {
  const r = callerRole(context);
  if (!allowed.includes(r)) {
    throw new functions.https.HttpsError("permission-denied", "Not allowed.");
  }
}

async function countActiveAdmins() {
  const snap = await admin.firestore()
    .collection("users")
    .where("role", "==", "admin")
    .where("active", "==", true)
    .get();
  return snap.size;
}

async function getUserClaims(uid) {
  const user = await admin.auth().getUser(uid);
  return { user, claims: user.customClaims || {} };
}

async function setClaims(uid, claims) {
  await admin.auth().setCustomUserClaims(uid, claims);
}

// ---------- One-time bootstrap (SAFE) ----------
// Only works if:
// - caller is logged in as 777mlvl@gmail.com
// - AND there are currently 0 active admins in Firestore users collection
exports.bootstrapAdmin = functions.https.onCall(async (data, context) => {
  requireAuth(context);

  const targetEmail = "777mlvl@gmail.com";
  if (callerEmail(context) !== targetEmail) {
    throw new functions.https.HttpsError("permission-denied", "Not allowed.");
  }

  const adminCount = await countActiveAdmins();
  if (adminCount > 0) {
    throw new functions.https.HttpsError("failed-precondition", "Admin already exists.");
  }

  const user = await admin.auth().getUserByEmail(targetEmail);

  await setClaims(user.uid, { role: "admin", active: true });

  await admin.firestore().doc(`users/${user.uid}`).set({
    email: targetEmail,
    role: "admin",
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, uid: user.uid, email: targetEmail };
});

// ---------- Approve pending user (Manager/Admin) ----------
// manager/admin can approve, but manager cannot grant admin
exports.approveUser = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  requireActive(context);
  requireRole(context, ["manager", "admin"]);

  const { uid, role } = data || {};
  if (!uid || typeof uid !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "uid required.");
  }
  if (!ALLOWED_ROLES.includes(role) || role === "pending") {
    throw new functions.https.HttpsError("invalid-argument", "Invalid role.");
  }

  if (callerRole(context) === "manager" && role === "admin") {
    throw new functions.https.HttpsError("permission-denied", "Managers cannot assign admin.");
  }

  // preserve existing active if present, default true
  const { claims } = await getUserClaims(uid);
  const active = claims.active !== false;

  await setClaims(uid, { role, active: true });

  await admin.firestore().doc(`users/${uid}`).set({
    role,
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

// ---------- Set user role (Admin only) ----------
// includes promotion to admin, and demotion from admin, BUT:
// - cannot change your own role
// - cannot demote the last active admin
exports.setUserRole = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  requireActive(context);
  requireRole(context, ["admin"]);

  const { uid, role } = data || {};
  if (!uid || typeof uid !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "uid required.");
  }
  if (!ALLOWED_ROLES.includes(role) || role === "pending") {
    throw new functions.https.HttpsError("invalid-argument", "Invalid role.");
  }

  // prevent self-demotion / self role edits
  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Admin cannot change own role.");
  }

  const { claims } = await getUserClaims(uid);
  const currentRole = claims.role || "pending";
  const currentActive = claims.active !== false;

  // if demoting an admin, ensure not last admin
  if (currentRole === "admin" && role !== "admin") {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot remove the last admin.");
    }
  }

  await setClaims(uid, { role, active: currentActive });

  await admin.firestore().doc(`users/${uid}`).set({
    role,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

// ---------- Set user active (Admin only) ----------
// can deactivate/activate users, BUT:
// - cannot deactivate self
// - cannot deactivate last active admin
exports.setUserActive = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  requireActive(context);
  requireRole(context, ["admin"]);

  const { uid, active } = data || {};
  if (!uid || typeof uid !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "uid required.");
  }
  if (typeof active !== "boolean") {
    throw new functions.https.HttpsError("invalid-argument", "active must be boolean.");
  }

  // prevent self-deactivate
  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Admin cannot deactivate self.");
  }

  const { claims } = await getUserClaims(uid);
  const role = claims.role || "pending";

  // prevent deactivating last admin
  if (role === "admin" && active === false) {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot deactivate the last admin.");
    }
  }

  await setClaims(uid, { role, active });

  await admin.firestore().doc(`users/${uid}`).set({
    active,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

// ---------- Delete user (Admin only) ----------
// deletes Auth user + Firestore profile, BUT:
// - cannot delete self
// - cannot delete last active admin
exports.deleteUser = functions.https.onCall(async (data, context) => {
  requireAuth(context);
  requireActive(context);
  requireRole(context, ["admin"]);

  const { uid } = data || {};
  if (!uid || typeof uid !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "uid required.");
  }

  // prevent self-delete
  if (uid === context.auth.uid) {
    throw new functions.https.HttpsError("permission-denied", "Admin cannot delete self.");
  }

  // check if target is an active admin in Firestore
  const userDoc = await admin.firestore().doc(`users/${uid}`).get();
  const role = userDoc.exists ? (userDoc.data().role || "pending") : "pending";
  const isActive = userDoc.exists ? (userDoc.data().active !== false) : false;

  if (role === "admin" && isActive) {
    const admins = await countActiveAdmins();
    if (admins <= 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot delete the last admin.");
    }
  }

  // delete Auth + Firestore
  await admin.auth().deleteUser(uid);
  await admin.firestore().doc(`users/${uid}`).delete();

  return { ok: true };
});
