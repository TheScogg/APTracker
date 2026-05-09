import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut as fbSignOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, runTransaction, query, orderBy, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyABjasNBbJnsqq4M_UxKruKrN6-O2FXCwc",
  authDomain: "press-tracker-9d9c9.firebaseapp.com",
  projectId: "press-tracker-9d9c9",
  storageBucket: "press-tracker-9d9c9.firebasestorage.app",
  messagingSenderId: "943200266003",
  appId: "1:943200266003:web:4d24eab551a3fb145c1ce6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storageFallback = firebaseConfig.storageBucket && firebaseConfig.storageBucket.includes('.appspot.com')
  ? getStorage(app, `gs://${firebaseConfig.projectId}.appspot.com`)
  : getStorage(app);
const provider = new GoogleAuthProvider();

const DEFAULT_PRESSES = {
  "Row 1": ["1.01","1.02","1.03","1.04","1.05","1.06","1.07","1.08","1.09","1.10","1.11","1.12","1.13","1.14","1.15","1.16","1.17"],
  "Row 2": ["2.01","2.02","2.03","2.04","2.05","2.06","2.07","2.08","2.09","2.10","2.11","2.12","2.13","2.14","2.15","2.16","2.17","2.18","2.19","2.20","2.21","2.22"],
  "Row 3": ["3.01","3.02","3.03","3.04","3.05","3.06","3.07","3.08","3.09","3.10","3.12","3.13","3.14","3.15","3.16","3.17","3.18","3.19"],
  "Row 4": ["4.01","4.02","4.03","4.04","4.05","4.06","4.07","4.08","4.09","4.10","4.11","4.12","4.13","4.14","4.15","4.16","4.17"],
  "Row 5": ["5.01","5.02","5.03","5.04","5.05","5.06","5.07","5.08","5.09","5.10","5.11","5.12"],
  "Row 6": ["6.01","6.02","6.03","6.05","6.06","6.07"],
  "Other": ["Auto Cell","BR-1","CR-1","CR-2"]
};

// DOM Elements
const elLogin = document.getElementById('login-screen');
const elApp = document.getElementById('app-screen');
const elWhoami = document.getElementById('whoami');
const elPlantSelect = document.getElementById('plant-select');
const elPressSelect = document.getElementById('press-select');
const elPageList = document.getElementById('page-list');
const elNewPageBtn = document.getElementById('new-page-btn');
const elEditorContainer = document.getElementById('editor-container');
const elEmptyState = document.getElementById('empty-state');

// Editor DOM
const elTitle = document.getElementById('edit-title');
const elSlug = document.getElementById('edit-slug');
const elSummary = document.getElementById('edit-summary');
const elTags = document.getElementById('edit-tags');
const elBody = document.getElementById('edit-body');
const elChangeNote = document.getElementById('edit-change-note');
const elFileInput = document.getElementById('edit-file-input');
const elAttachments = document.getElementById('edit-attachments');
const elRevisionList = document.getElementById('revision-list');
const elSaveFeedback = document.getElementById('save-feedback');

// State
let currentUser = null;
let currentPlantId = null;
let currentPressId = null;
let currentPageId = null;
let pages = [];
let currentPageDoc = null;
let attachmentsMap = new Map();
let unsubscribePages = null;

// Initialization URL Params
const urlParams = new URLSearchParams(window.location.search);
const initPlantId = urlParams.get('plantId');
const initPressId = urlParams.get('pressId');
const initPageId = urlParams.get('pageId');

function showFeedback(msg, isError) {
  elSaveFeedback.textContent = msg;
  elSaveFeedback.style.color = isError ? 'var(--red)' : 'var(--green)';
}

document.getElementById('google-signin-btn').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    document.getElementById('login-feedback').textContent = err.message;
  }
});

document.getElementById('signout-btn').addEventListener('click', () => {
  fbSignOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    elLogin.classList.remove('visible');
    elApp.classList.add('visible');
    elWhoami.textContent = user.email;
    await loadPlants();
  } else {
    currentUser = null;
    elLogin.classList.add('visible');
    elApp.classList.remove('visible');
  }
});

async function loadPlants() {
  const q = query(collection(db, 'plants'));
  const snap = await getDocs(q);
  const myPlants = [];
  
  for (const docSnap of snap.docs) {
    const memSnap = await getDoc(doc(db, `plants/${docSnap.id}/members/${currentUser.uid}`));
    if (memSnap.exists()) {
      myPlants.push({ id: docSnap.id, name: docSnap.data().name || docSnap.id });
    }
  }
  
  elPlantSelect.innerHTML = '<option value="">Select a plant...</option>';
  myPlants.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    elPlantSelect.appendChild(opt);
  });
  
  if (initPlantId && myPlants.find(p => p.id === initPlantId)) {
    elPlantSelect.value = initPlantId;
    await handlePlantChange();
    if (initPressId) {
      elPressSelect.value = initPressId;
      await handlePressChange();
      if (initPageId) {
        selectPage(initPageId);
      }
    }
  }
}

elPlantSelect.addEventListener('change', handlePlantChange);
async function handlePlantChange() {
  currentPlantId = elPlantSelect.value;
  elPressSelect.innerHTML = '<option value="">Select a press...</option>';
  elPressSelect.disabled = true;
  elNewPageBtn.disabled = true;
  resetEditor();
  
  if (!currentPlantId) return;
  
  // Fetch presses
  const confSnap = await getDoc(doc(db, `plants/${currentPlantId}/config/presses`));
  let pressConfig = DEFAULT_PRESSES;
  if (confSnap.exists() && confSnap.data().rows) {
    pressConfig = confSnap.data().rows;
  }
  
  const presses = [];
  Object.values(pressConfig).forEach(row => {
    row.forEach(p => presses.push(p));
  });
  presses.sort();
  
  presses.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    elPressSelect.appendChild(opt);
  });
  elPressSelect.disabled = false;
}

elPressSelect.addEventListener('change', handlePressChange);
async function handlePressChange() {
  currentPressId = elPressSelect.value;
  resetEditor();
  
  if (!currentPressId) {
    elNewPageBtn.disabled = true;
    if (unsubscribePages) { unsubscribePages(); unsubscribePages = null; }
    elPageList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px;">Select a press to view pages</div>';
    return;
  }
  
  elNewPageBtn.disabled = false;
  elPageList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px;">Loading pages...</div>';
  
  if (unsubscribePages) unsubscribePages();
  const pagesRef = collection(db, `plants/${currentPlantId}/presses/${currentPressId}/wikiPages`);
  unsubscribePages = onSnapshot(pagesRef, (snap) => {
    pages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPageList();
    if (currentPageId) {
      const activePage = pages.find(p => p.id === currentPageId);
      if (activePage) updateEditorMeta(activePage);
    }
  });
}

function renderPageList() {
  elPageList.innerHTML = '';
  if (pages.length === 0) {
    elPageList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px;">No pages found</div>';
    return;
  }
  
  pages.sort((a,b) => (a.title || '').localeCompare(b.title || ''));
  pages.forEach(p => {
    const li = document.createElement('li');
    li.className = `page-item ${p.id === currentPageId ? 'active' : ''}`;
    li.innerHTML = `
      <div class="page-title">${p.title || 'Untitled'}</div>
      <div class="page-meta">Photos: ${p.photoCount || 0}</div>
    `;
    li.addEventListener('click', () => selectPage(p.id));
    elPageList.appendChild(li);
  });
}

function resetEditor() {
  currentPageId = null;
  currentPageDoc = null;
  elEditorContainer.style.display = 'none';
  elEmptyState.style.display = 'flex';
  elTitle.value = '';
  elSlug.value = '';
  elSummary.value = '';
  elTags.value = '';
  elBody.value = '';
  elChangeNote.value = '';
  elAttachments.innerHTML = '';
  elRevisionList.innerHTML = '';
  attachmentsMap.clear();
  renderPageList();
}

elNewPageBtn.addEventListener('click', () => {
  currentPageId = 'NEW';
  currentPageDoc = null;
  elEditorContainer.style.display = 'block';
  elEmptyState.style.display = 'none';
  elTitle.value = '';
  elSlug.value = '';
  elSummary.value = '';
  elTags.value = '';
  elBody.value = '';
  elChangeNote.value = 'Initial creation';
  elAttachments.innerHTML = '';
  elRevisionList.innerHTML = '<div class="rev-date">No revisions yet</div>';
  attachmentsMap.clear();
  renderPageList();
  elTitle.focus();
});

async function selectPage(pageId) {
  if (pageId === currentPageId) return;
  currentPageId = pageId;
  elEditorContainer.style.display = 'block';
  elEmptyState.style.display = 'none';
  renderPageList();
  
  const pageData = pages.find(p => p.id === pageId);
  if (pageData) {
    updateEditorMeta(pageData);
    currentPageDoc = pageData;
    
    // Fetch latest revision body
    const revsSnap = await getDocs(query(
      collection(db, `plants/${currentPlantId}/presses/${currentPressId}/wikiPages/${pageId}/revisions`),
      orderBy('editedAt', 'desc')
    ));
    
    elRevisionList.innerHTML = '';
    let latestRev = null;
    
    revsSnap.docs.forEach((docSnap, i) => {
      const data = docSnap.data();
      if (i === 0) {
        latestRev = data;
        elBody.value = data.body || '';
      }
      
      const dStr = data.editedAt?.toDate ? data.editedAt.toDate().toLocaleString() : 'Just now';
      elRevisionList.insertAdjacentHTML('beforeend', `
        <div class="revision-item">
          <div class="rev-date">${dStr}</div>
          <div class="rev-note">${data.changeNote || 'No note'}</div>
        </div>
      `);
    });
    
    // Fetch attachments
    const attSnap = await getDocs(collection(db, `plants/${currentPlantId}/presses/${currentPressId}/wikiPages/${pageId}/attachments`));
    attachmentsMap.clear();
    attSnap.docs.forEach(docSnap => attachmentsMap.set(docSnap.id, docSnap.data()));
    renderAttachments();
    
    elChangeNote.value = '';
  }
}

function updateEditorMeta(page) {
  elTitle.value = page.title || '';
  elSlug.value = page.slug || page.id || '';
  elSummary.value = page.summary || '';
  elTags.value = (page.tags || []).join(', ');
}

// Generate an ID for new pages based on title
elTitle.addEventListener('input', () => {
  if (currentPageId === 'NEW') {
    elSlug.value = elTitle.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
});

// Photo upload placeholder logic
document.getElementById('upload-photo-btn').addEventListener('click', () => {
  elFileInput.click();
});

elFileInput.addEventListener('change', async (e) => {
  if (!e.target.files.length) return;
  
  // We need a pageId before we can attach photos.
  if (currentPageId === 'NEW') {
    alert("Please save the page first before attaching photos.");
    return;
  }

  showFeedback("Uploading photos...", false);
  
  try {
    for (const file of e.target.files) {
      const attId = 'att_' + Date.now() + '_' + Math.floor(Math.random()*1000);
      const ext = file.name.split('.').pop();
      const path = `plants/${currentPlantId}/press-wiki/${currentPressId}/${currentPageId}/${attId}.${ext}`;
      const sRef = storageRef(storageFallback, path);
      
      await uploadBytesResumable(sRef, file);
      const url = await getDownloadURL(sRef);
      
      const attDoc = {
        storagePath: path,
        url: url,
        contentType: file.type,
        caption: file.name,
        uploadedBy: currentUser.uid,
        uploadedAt: serverTimestamp()
      };
      
      await setDoc(doc(db, `plants/${currentPlantId}/presses/${currentPressId}/wikiPages/${currentPageId}/attachments/${attId}`), attDoc);
      attachmentsMap.set(attId, attDoc);
    }
    
    // Update photo count
    await updateDoc(doc(db, `plants/${currentPlantId}/presses/${currentPressId}/wikiPages/${currentPageId}`), {
      photoCount: attachmentsMap.size
    });
    
    renderAttachments();
    showFeedback("Upload complete.", false);
  } catch (err) {
    showFeedback("Upload failed: " + err.message, true);
  }
  
  elFileInput.value = '';
});

function renderAttachments() {
  elAttachments.innerHTML = '';
  attachmentsMap.forEach((att, id) => {
    const tile = document.createElement('div');
    tile.className = 'attachment-tile';
    tile.style.backgroundImage = `url(${att.url})`;
    
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '✕';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if(confirm('Delete this photo?')) {
        await deleteAttachment(id, att);
      }
    };
    
    // Click tile to insert markdown into body
    tile.onclick = () => {
      const md = `\n![${att.caption}](${att.url})\n`;
      const pos = elBody.selectionStart;
      const text = elBody.value;
      elBody.value = text.slice(0, pos) + md + text.slice(pos);
      elBody.focus();
    };
    
    tile.appendChild(delBtn);
    elAttachments.appendChild(tile);
  });
}

async function deleteAttachment(attId, attData) {
  try {
    const sRef = storageRef(storageFallback, attData.storagePath);
    await deleteObject(sRef).catch(e => console.log('Storage del failed', e));
    await setDoc(doc(db, `plants/${currentPlantId}/presses/${currentPressId}/wikiPages/${currentPageId}/attachments/${attId}`), { _deleted: true }, { merge: false }); // Optional: archive instead of actual delete. Using deleteDoc.
    await deleteDoc(doc(db, `plants/${currentPlantId}/presses/${currentPressId}/wikiPages/${currentPageId}/attachments/${attId}`));
    attachmentsMap.delete(attId);
    renderAttachments();
  } catch(e) {}
}

document.getElementById('cancel-btn').addEventListener('click', () => {
  if (currentPageId === 'NEW') resetEditor();
  else selectPage(currentPageId); // reload
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const title = elTitle.value.trim();
  const slug = elSlug.value.trim() || 'untitled';
  const summary = elSummary.value.trim();
  const tagsStr = elTags.value.trim();
  const body = elBody.value.trim();
  const changeNote = elChangeNote.value.trim();
  
  if (!title) return showFeedback("Title is required", true);
  if (!changeNote) return showFeedback("Change Note is required", true);
  
  showFeedback("Saving...", false);
  document.getElementById('save-btn').disabled = true;
  
  try {
    const isNew = (currentPageId === 'NEW');
    const pageId = isNew ? slug : currentPageId;
    const revId = 'rev_' + Date.now();
    
    const pageRef = doc(db, `plants/${currentPlantId}/presses/${currentPressId}/wikiPages/${pageId}`);
    const revRef = doc(db, `plants/${currentPlantId}/presses/${currentPressId}/wikiPages/${pageId}/revisions/${revId}`);
    
    await runTransaction(db, async (t) => {
      let pageData = {
        title: title,
        slug: slug,
        summary: summary,
        tags: tagsStr.split(',').map(s=>s.trim()).filter(Boolean),
        searchText: `${title} ${summary} ${tagsStr}`.toLowerCase(),
        updatedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        currentRevisionId: revId
      };
      
      if (isNew) {
        const snap = await t.get(pageRef);
        if (snap.exists()) throw new Error("A page with this slug already exists.");
        pageData.createdBy = currentUser.uid;
        pageData.createdAt = serverTimestamp();
        pageData.photoCount = 0;
        t.set(pageRef, pageData);
      } else {
        t.update(pageRef, pageData);
      }
      
      t.set(revRef, {
        body: body,
        changeNote: changeNote,
        prevRevisionId: currentPageDoc ? currentPageDoc.currentRevisionId : null,
        editedBy: currentUser.uid,
        editedAt: serverTimestamp()
      });
    });
    
    showFeedback("Saved successfully!", false);
    elChangeNote.value = '';
    
    if (isNew) {
      currentPageId = pageId;
      // selection will update automatically via onSnapshot
    } else {
      // Manual refresh of revisions list
      selectPage(pageId);
    }
    
  } catch (err) {
    showFeedback("Error saving: " + err.message, true);
  } finally {
    document.getElementById('save-btn').disabled = false;
  }
});
