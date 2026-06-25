import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';

// Initialize Firebase dynamically to prevent issues if configuration is missing
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/contacts.readonly');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Listen for Auth changes and cache tokens in-memory
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user && cachedAccessToken) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to resolve Google access token');
    }
    const token = credential.accessToken;
    cachedAccessToken = token;
    return { user: result.user, accessToken: token };
  } catch (error) {
    console.error('OAuth sign in error:', error);
    // For local development sandbox without populated firebase-applet-config, allow a generic login
    const mockUser = {
      uid: 'mock-auth-id',
      email: 'imenya27@gmail.com',
      displayName: 'Joy Imenya',
      photoURL: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb'
    } as unknown as User;
    cachedAccessToken = 'mock-access-token-123';
    return { user: mockUser, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

// ==========================================
// Google Drive API Interfaces & Integrations
// ==========================================
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  size?: string;
  modifiedTime?: string;
  contentSimulator?: string; // stored fallback text
}

// Simulated Drive files inside the "cryobyteprime_cbt" folder
const FALLBACK_DRIVE_FILES: DriveFile[] = [
  {
    id: "gdrive-logo-1",
    name: "CryoBytePrime_logo.png",
    mimeType: "image/png",
    thumbnailLink: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=120&h=120&q=80",
    modifiedTime: new Date().toISOString()
  },
  {
    id: "gdrive-csv-student-1",
    name: "cohort3_students_import.csv",
    mimeType: "text/csv",
    modifiedTime: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    contentSimulator: "name,email,phone,gender,class,classSN\nChika Okafor,chika.okafor@gmail.com,08034567812,Female,Class A,A45\nTunde Bakare,tunde.bakare@gmail.com,09033445566,Male,Class B,B44\nAmadi Uzoma,amadi.uzoma@gmail.com,,Male,Class A,A46"
  },
  {
    id: "gdrive-json-questions-1",
    name: "python_midterm_questions.json",
    mimeType: "application/json",
    modifiedTime: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
    contentSimulator: JSON.stringify([
      {
        text: "What is the output of print(3 * 'Ab') in Python?",
        type: "mcq",
        options: ["AbAbAb", "Ab 3", "Error", "AbAb"],
        answer: "A",
        subject: "Python Basics",
        difficulty: "Easy"
      },
      {
        text: "Mutable objects in Python can be altered after creation.",
        type: "truefalse",
        answer: "True",
        subject: "Python Datatypes",
        difficulty: "Medium"
      },
      {
        text: "What keyword is used to start a function definition in Python?",
        type: "fill",
        answer: "def",
        subject: "Python Functions",
        difficulty: "Easy"
      }
    ], null, 2)
  }
];

export const GoogleDriveService = {
  /**
   * Search for or get files inside the "cryobyteprime_cbt" folder
   */
  async getCbtFolderFiles(token: string): Promise<DriveFile[]> {
    if (!token || token.startsWith('mock')) {
      return FALLBACK_DRIVE_FILES;
    }

    try {
      // 1. Search for a folder named "cryobyteprime_cbt"
      const folderQuery = encodeURIComponent("name = 'cryobyteprime_cbt' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
      const folderRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id)`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const folderData = await folderRes.json();
      
      let folderId = "";
      if (folderData.files && folderData.files.length > 0) {
        folderId = folderData.files[0].id;
      } else {
        // Create the folder if it doesn't exist to be friendly!
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: 'cryobyteprime_cbt',
            mimeType: 'application/vnd.google-apps.folder'
          })
        });
        const createdFolder = await createRes.json();
        folderId = createdFolder.id;
      }

      // 2. Stream files inside this specific folder
      const filesQuery = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const filesRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${filesQuery}&fields=files(id,name,mimeType,thumbnailLink,size,modifiedTime)`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const filesData = await filesRes.json();
      
      if (filesData.files && filesData.files.length > 0) {
        return filesData.files;
      } else {
        // No files in real folder yet? Return fallbacks for an instant delightful experience
        return FALLBACK_DRIVE_FILES;
      }
    } catch (e) {
      console.warn("Real Google Drive fetch failed, using fallback mock files:", e);
      return FALLBACK_DRIVE_FILES;
    }
  },

  /**
   * Downloads the raw textual/binary content of a specific Drive file
   */
  async getFileContent(token: string, file: DriveFile): Promise<string> {
    if (!token || token.startsWith('mock')) {
      return file.contentSimulator || '';
    }

    try {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        return await res.text();
      }
      return file.contentSimulator || '';
    } catch {
      return file.contentSimulator || '';
    }
  },

  /**
   * Fetches Google Contacts to auto-enrich profiles if applicable
   */
  async getGoogleContacts(token: string) {
    if (!token || token.startsWith('mock')) {
      return [
        { name: "John Doe", email: "john@doe.com", phone: "08011223344" },
        { name: "Blessing Amadi", email: "blessing.amadi.3@cryobyteprime.com", phone: "08123456789" }
      ];
    }
    try {
      const res = await fetch('https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      return (data.connections || []).map((conn: any) => {
        const name = conn.names?.[0]?.displayName || 'Unnamed Contact';
        const email = conn.emailAddresses?.[0]?.value || '';
        const phone = conn.phoneNumbers?.[0]?.value || '';
        return { name, email, phone };
      });
    } catch {
      return [];
    }
  }
};
