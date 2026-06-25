import { Question, AttRecord, AttendanceStanding } from '../types';

/**
 * Natural sorting utility for class serial numbers (e.g. A1, A2, A10, B3)
 */
export function naturalSort(a: string, b: string): number {
  const regex = /^([A-Z]+)(\d+)$/i;
  const matchA = String(a).toUpperCase().match(regex);
  const matchB = String(b).toUpperCase().match(regex);
  if (matchA && matchB) {
    if (matchA[1] !== matchB[1]) return matchA[1].localeCompare(matchB[1]);
    return parseInt(matchA[2], 10) - parseInt(matchB[2], 10);
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Single evaluation function for all question types across the exam system
 */
export function scoreAnswer(question: Question, studentAnswer: string | boolean): boolean {
  if (studentAnswer === undefined || studentAnswer === null || studentAnswer === '') return false;
  
  const normAnswer = String(question.answer).trim().toLowerCase();
  const normStudent = String(studentAnswer).trim().toLowerCase();
  
  switch (question.type) {
    case 'mcq':
      // MCQ expects precise option key (e.g., A, B, C, D)
      return normStudent === normAnswer;
    case 'truefalse':
      // Standardize boolean values to strings "true" or "false"
      return normStudent === normAnswer;
    case 'fill':
      // Loose match on fill-in-the-blanks with trimming and case-insensitivity
      return normStudent === normAnswer;
    default:
      return false;
  }
}

/**
 * Computes standing color/status from percentage
 */
export function getStanding(pct: number): AttendanceStanding {
  if (pct >= 75) return 'good';
  if (pct >= 50) return 'risk';
  return 'poor';
}

/**
 * Calculates consecutive present sessions streak (most recent descending, stops at first absence/late)
 */
export function calculateStreak(email: string, records: AttRecord[]): number {
  const studentRecords = records
    .filter(r => r.email.toLowerCase() === email.toLowerCase())
    .sort((a, b) => b.date.localeCompare(a.date)); // Sort date descending (newest first)
  
  let currentStreak = 0;
  for (const record of studentRecords) {
    if (record.status === 'present') {
      currentStreak++;
    } else {
      break; // Stops at first absence or late check-in
    }
  }
  return currentStreak;
}
