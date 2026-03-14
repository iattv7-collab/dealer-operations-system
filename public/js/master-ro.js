import { renderNav } from "/js/nav.js";
import { requireRole } from "/js/guard.js";
import { db } from "/js/firebase.js";

import {
collection,
onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

document.getElementById("nav").innerHTML = renderNav("masterro");

requireRole(["admin","manager","advisor","booker","wash","valet","qc"]);

const tbody = document.getElementById("ro-body");

onSnapshot(collection(db,"ros"),(snap)=>{

tbody.innerHTML="";

snap.forEach(doc=>{

const r = doc.data();

const tr = document.createElement("tr");

tr.innerHTML=`
<td>${r.ro || doc.id}</td>
<td>${r.customerName || ""}</td>
<td>${r.phone || ""}</td>
<td>${r.tag || ""}</td>
<td>${r.model || ""}</td>
<td>${r.concern || ""}</td>
`;

tbody.appendChild(tr);

});

});