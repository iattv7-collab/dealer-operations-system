const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });
const Busboy = require("busboy");
const vision = require("@google-cloud/vision");

admin.initializeApp();

const visionClient = new vision.ImageAnnotatorClient();

const ALLOWED_ROLES = ["admin","manager","advisor","wash","staff","booker","qc","pending"];


/* ==============================
   AUTH HELPERS
============================== */

function requireAuth(context){
  if(!context.auth){
    throw new functions.https.HttpsError("unauthenticated","Login required");
  }
}

function callerRole(context){
  return context.auth?.token?.role || "pending";
}

function callerActive(context){
  return context.auth?.token?.active === true;
}

function requireActive(context){
  if(!callerActive(context)){
    throw new functions.https.HttpsError("permission-denied","Account disabled");
  }
}

function requireRole(context,roles){
  const r = callerRole(context);
  if(!roles.includes(r)){
    throw new functions.https.HttpsError("permission-denied","Not allowed");
  }
}


/* ==============================
   USER MANAGEMENT
============================== */

async function setClaims(uid,claims){
  await admin.auth().setCustomUserClaims(uid,claims);
}

exports.approveUser = functions.https.onCall(async (data,context)=>{

  requireAuth(context);
  requireActive(context);
  requireRole(context,["admin","manager"]);

  const {uid,role} = data;

  if(!uid){
    throw new functions.https.HttpsError("invalid-argument","uid required");
  }

  if(!ALLOWED_ROLES.includes(role) || role==="pending"){
    throw new functions.https.HttpsError("invalid-argument","invalid role");
  }

  await setClaims(uid,{role,active:true});

  await admin.firestore().doc(`users/${uid}`).set({
    role,
    active:true,
    updatedAt:admin.firestore.FieldValue.serverTimestamp()
  },{merge:true});

  return {ok:true};

});


exports.setUserActive = functions.https.onCall(async (data,context)=>{

  requireAuth(context);
  requireActive(context);
  requireRole(context,["admin"]);

  const {uid,active} = data;

  await setClaims(uid,{
    role:(await admin.auth().getUser(uid)).customClaims?.role || "pending",
    active
  });

  await admin.firestore().doc(`users/${uid}`).set({
    active,
    updatedAt:admin.firestore.FieldValue.serverTimestamp()
  },{merge:true});

  return {ok:true};

});


exports.deleteUser = functions.https.onCall(async (data,context)=>{

  requireAuth(context);
  requireActive(context);
  requireRole(context,["admin"]);

  const {uid} = data;

  await admin.auth().deleteUser(uid);
  await admin.firestore().doc(`users/${uid}`).delete();

  return {ok:true};

});


/* ==============================
   SCHEDULER
============================== */

const SCHEDULER_KEYS = [
"scheduledAtMs",
"scheduledEndAtMs",
"scheduledBay",
"scheduleRisk",
"scheduleUpdatedAtMs"
];


exports.onWashTicketWrite = functions.firestore
.document("washTickets/{ticketId}")
.onWrite(async(change,context)=>{

  const after = change.after.exists ? change.after.data() : null;

  if(!after) return null;

  const db = admin.firestore();

  const snap = await db.collection("washTickets")
  .where("status","in",["queued","washing"])
  .get();

  const batch = db.batch();
  const now = Date.now();

  let bay=1;

  snap.forEach(doc=>{

    const ref = db.collection("washTickets").doc(doc.id);

    batch.set(ref,{
      scheduledBay:bay,
      scheduledAtMs:now,
      scheduledEndAtMs:now+900000,
      scheduleRisk:"onTime",
      scheduleUpdatedAtMs:now
    },{merge:true});

    bay++;

  });

  await batch.commit();

  return null;

});


exports.onSettingsSystemWrite = functions.firestore
.document("settings/system")
.onWrite(async()=>{

  const db = admin.firestore();

  const snap = await db.collection("washTickets")
  .where("status","in",["queued","washing"])
  .get();

  const batch = db.batch();
  const now = Date.now();

  let bay=1;

  snap.forEach(doc=>{

    const ref = db.collection("washTickets").doc(doc.id);

    batch.set(ref,{
      scheduledBay:bay,
      scheduledAtMs:now,
      scheduledEndAtMs:now+900000,
      scheduleRisk:"onTime",
      scheduleUpdatedAtMs:now
    },{merge:true});

    bay++;

  });

  await batch.commit();

  return null;

});


/* ==============================
   RO SCANNER
============================== */

exports.scanRO = functions.https.onRequest((req,res)=>{

  cors(req,res,async()=>{

    try{

      const busboy = new Busboy({headers:req.headers});

      const buffers=[];

      busboy.on("file",(fieldname,file)=>{

        file.on("data",(data)=>{
          buffers.push(data);
        });

      });

      busboy.on("finish",async()=>{

        const buffer = Buffer.concat(buffers);

        const [result] = await visionClient.textDetection(buffer);

        const detections = result.textAnnotations;

        const text = detections.length ? detections[0].description : "";

        res.json({
          ok:true,
          text
        });

      });

      busboy.end(req.rawBody);

    }
    catch(err){

      console.error(err);

      res.status(500).json({
        ok:false,
        error:err.message
      });

    }

  });

});