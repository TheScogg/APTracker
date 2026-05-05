import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const keyPath = path.resolve('./serviceAccountKey.json');
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function testConnection() {
  try {
    console.log('Connected to project:', serviceAccount.project_id);
    
    // Let's check for plants
    const plantsSnap = await db.collection('plants').limit(5).get();
    if (plantsSnap.empty) {
      console.log('No plants found in the "plants" collection.');
    } else {
      console.log('\nFound plants:');
      plantsSnap.forEach(doc => {
        console.log(`- Plant ID: ${doc.id}`);
      });
    }

    // Let's check for users
    const usersSnap = await db.collection('users').limit(5).get();
    if (usersSnap.empty) {
      console.log('\nNo users found in the "users" collection.');
    } else {
      console.log('\nFound users:');
      usersSnap.forEach(doc => {
        console.log(`- User ID: ${doc.id}`);
      });
    }

  } catch (error) {
    console.error('Error connecting to Firestore:', error.message);
  }
}

testConnection();
