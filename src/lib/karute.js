import { db } from '../firebase';
import {
  collection, doc, getDoc, getDocs,
  addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from 'firebase/firestore';

function declarationsRef() {
  return collection(db, 'declarations');
}

export async function getDeclaration(staffName, month) {
  try {
    const q = query(
      declarationsRef(),
      where('staffName', '==', staffName),
      where('month', '==', month)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  } catch (e) {
    console.error('getDeclaration error:', e);
    return null;
  }
}

export async function getDeclarationHistory(staffName) {
  try {
    const q = query(
      declarationsRef(),
      where('staffName', '==', staffName),
      orderBy('month', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('getDeclarationHistory error:', e);
    return [];
  }
}

export async function getAllDeclarationsForMonth(month) {
  try {
    const q = query(
      declarationsRef(),
      where('month', '==', month)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('getAllDeclarationsForMonth error:', e);
    return [];
  }
}

export async function createDeclaration(staffName, month, tactics) {
  try {
    const declaration = {
      staffName,
      month,
      tactics,
      monthlyReview: null,
      adminComments: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const docRef = await addDoc(declarationsRef(), declaration);
    return { id: docRef.id, ...declaration };
  } catch (e) {
    console.error('createDeclaration error:', e);
    throw e;
  }
}

export async function updateDeclarationTactics(declarationId, tactics) {
  try {
    const ref = doc(db, 'declarations', declarationId);
    await updateDoc(ref, {
      tactics,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('updateDeclarationTactics error:', e);
    throw e;
  }
}

export async function updateTacticStatus(declarationId, tacticIndex, status) {
  try {
    const ref = doc(db, 'declarations', declarationId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Declaration not found');
    const data = snap.data();
    const tactics = [...data.tactics];
    tactics[tacticIndex] = { ...tactics[tacticIndex], status };
    await updateDoc(ref, { tactics, updatedAt: serverTimestamp() });
  } catch (e) {
    console.error('updateTacticStatus error:', e);
    throw e;
  }
}

export async function submitCheckpoint(declarationId, tacticIndex, checkpointIndex, data) {
  try {
    const ref = doc(db, 'declarations', declarationId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Declaration not found');
    const declaration = snap.data();
    const tactics = [...declaration.tactics];
    const cps = [...tactics[tacticIndex].checkpoints];
    cps[checkpointIndex] = {
      ...cps[checkpointIndex],
      ...data,
      submitted: true,
      submittedAt: new Date().toISOString(),
    };
    tactics[tacticIndex] = { ...tactics[tacticIndex], checkpoints: cps };
    await updateDoc(ref, {
      tactics,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('submitCheckpoint error:', e);
    throw e;
  }
}

export async function submitMonthlyReview(declarationId, review) {
  try {
    const ref = doc(db, 'declarations', declarationId);
    await updateDoc(ref, {
      monthlyReview: {
        ...review,
        submittedAt: new Date().toISOString(),
      },
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('submitMonthlyReview error:', e);
    throw e;
  }
}

export async function addAdminComment(declarationId, comment) {
  try {
    const ref = doc(db, 'declarations', declarationId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Declaration not found');
    const data = snap.data();
    const adminComments = data.adminComments || [];
    adminComments.push({
      ...comment,
      createdAt: new Date().toISOString(),
    });
    await updateDoc(ref, {
      adminComments,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('addAdminComment error:', e);
    throw e;
  }
}

export async function deleteDeclaration(declarationId) {
  try {
    await deleteDoc(doc(db, 'declarations', declarationId));
  } catch (e) {
    console.error('deleteDeclaration error:', e);
    throw e;
  }
}

export async function getTacticPopularity(month) {
  const declarations = await getAllDeclarationsForMonth(month);
  const count = {};
  declarations.forEach(d => {
    (d.tactics || []).forEach(t => {
      count[t.id] = (count[t.id] || 0) + 1;
    });
  });
  return count;
}

export async function getStaffSummaryForMonth(month) {
  const declarations = await getAllDeclarationsForMonth(month);
  return declarations.map(d => {
    const totalCheckpoints = (d.tactics || []).reduce((sum, t) => sum + (t.checkpoints || []).length, 0);
    const submittedCheckpoints = (d.tactics || []).reduce(
      (sum, t) => sum + (t.checkpoints || []).filter(cp => cp.submitted).length, 0
    );
    return {
      id: d.id,
      staffName: d.staffName,
      month: d.month,
      tacticCount: (d.tactics || []).length,
      totalCheckpoints,
      submittedCheckpoints,
      hasMonthlyReview: !!d.monthlyReview,
      monthlyReview: d.monthlyReview,
    };
  });
}
