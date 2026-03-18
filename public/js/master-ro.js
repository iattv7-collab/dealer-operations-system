import { renderNav } from "/js/nav.js";
import { requireRole, getUserDealerId } from "/js/guard.js";
import { db, auth } from "/js/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
collection,
onSnapshot,
query,
where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

document.getElementById("nav").innerHTML = renderNav("masterro");

requireRole(["admin","manager","advisor","booker","wash","valet","qc"]);

const tbody=document.getElementById("ro-body");

onAuthStateChanged(auth,async(user)=>{
if(!user)return;

const dealerId=await getUserDealerId(user);

const q=query(
collection(db,"ros"),
where("dealerId","==",dealerId)
);

onSnapshot(q,(snap)=>{
tbody.innerHTML="";

snap.forEach(doc=>{
const r=doc.data();

const tr=document.createElement("tr");

tr.innerHTML=`
<td>${r.ro||doc.id}</td>
<td>${r.customerName||""}</td>
<td>${r.phone||""}</td>
<td>${r.tag||""}</td>
<td>${r.model||""}</td>
<td>${r.concern||""}</td>
`;

tbody.appendChild(tr);
});
});
});