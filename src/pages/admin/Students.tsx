import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Users, Search, Plus, Upload, Download, Trash2, Edit, X, Check, AlertCircle, 
  ChevronLeft, ChevronRight, ArrowUpDown, ChevronDown, Archive, FileSpreadsheet, 
  UserCheck, AlertTriangle, HelpCircle, ExternalLink, RefreshCw
} from 'lucide-react';
import { Student, AdminRole, AttendanceStanding, getStanding } from '../../types';
import { DB } from '../../lib/database';
import { naturalSort } from '../../lib/attendanceUtils';
import { jsPDF } from 'jspdf';
import { confirmAction } from '../../components/confirmAction';

interface StudentsProps {
  adminRole: AdminRole;
  adminEmail: string;
  triggerAuditLog: (action: string, page: string, original?: any, newValue?: any, reason?: string) => Promise<any>;
  onShowDeletionsPanel: () => void;
  protectionPasswordConfirm: (actionLabel: string, callback: () => void) => void;
}

export default function Students({
  adminRole,
  adminEmail,
  triggerAuditLog,
  onShowDeletionsPanel,
  protectionPasswordConfirm
}: StudentsProps) {
  // --- STATE ---
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [classFilter, setClassFilter] = useState<string>('All');
  const [genderFilter, setGenderFilter] = useState<string>('All');
  const [serialFrom, setSerialFrom] = useState<string>('');
  const [serialTo, setSerialTo] = useState<string>('');
  const [activeSort, setActiveSort] = useState<{ column: keyof Student; order: 'asc' | 'desc' }>({
    column: 'classSN',
    order: 'asc'
  });

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [rowsPerPage, setRowsPerPage] = useState<number | 'all'>(25);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal forms
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // Student details slide-panel
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
  const [panelStudent, setPanelStudent] = useState<Student | null>(null);
  const [panelAttendance, setPanelAttendance] = useState<{
    total: number;
    present: number;
    late: number;
    absent: number;
    pct: number;
    history: any[];
  }>({ total: 0, present: 0, late: 0, absent: 0, pct: 0, history: [] });
  const [panelExam, setPanelExam] = useState<any>(null);

  // CSV Import Modal Flow
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [importFileName, setImportFileName] = useState('');
  const [importedRows, setImportedRows] = useState<any[]>([]);
  const [importSummary, setImportSummary] = useState({ success: 0, skip: 0, invalid: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states (Controlled components)
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formGender, setFormGender] = useState<'Male' | 'Female' | ''>('');
  const [formClass, setFormClass] = useState<'Class A' | 'Class B'>('Class A');
  const [formSerial, setFormSerial] = useState('');
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string>>({});

  // Fetch data on init
  const fetchData = async () => {
    setLoading(true);
    const data = await DB.getStudents();
    setStudents(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- COMPUTE STATISTICS BAR ---
  const stats = useMemo(() => {
    const total = students.length;
    const classA = students.filter(s => s.class === 'Class A').length;
    const classB = students.filter(s => s.class === 'Class B').length;
    const male = students.filter(s => s.gender === 'Male').length;
    const female = students.filter(s => s.gender === 'Female').length;
    const noGender = students.filter(s => !s.gender).length;
    return { total, classA, classB, male, female, noGender };
  }, [students]);

  // --- FILTER & SORT LOGIC ---
  const filteredStudents = useMemo(() => {
    let result = [...students];

    // Text search debounced/evaluated
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(s => 
        s.name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        (s.phone && s.phone.includes(q)) ||
        s.classSN.toLowerCase().includes(q)
      );
    }

    // Class dropdown
    if (classFilter !== 'All') {
      result = result.filter(s => s.class === classFilter);
    }

    // Gender dropdown
    if (genderFilter !== 'All') {
      if (genderFilter === 'Not Set') {
        result = result.filter(s => !s.gender);
      } else {
        result = result.filter(s => s.gender === genderFilter);
      }
    }

    // Serial No Range (natural-sort comparison)
    if (serialFrom.trim()) {
      result = result.filter(s => naturalSort(s.classSN, serialFrom) >= 0);
    }
    if (serialTo.trim()) {
      result = result.filter(s => naturalSort(s.classSN, serialTo) <= 0);
    }

    // Dynamic sorts 
    result.sort((a, b) => {
      let valA = a[activeSort.column] || '';
      let valB = b[activeSort.column] || '';

      if (activeSort.column === 'classSN') {
        const orderMod = activeSort.order === 'asc' ? 1 : -1;
        return naturalSort(String(valA), String(valB)) * orderMod;
      }

      if (activeSort.order === 'asc') {
        return String(valA).localeCompare(String(valB), undefined, { numeric: true });
      } else {
        return String(valB).localeCompare(String(valA), undefined, { numeric: true });
      }
    });

    return result;
  }, [students, searchTerm, classFilter, genderFilter, serialFrom, serialTo, activeSort]);

  // Active Filters Count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchTerm.trim()) count++;
    if (classFilter !== 'All') count++;
    if (genderFilter !== 'All') count++;
    if (serialFrom.trim()) count++;
    if (serialTo.trim()) count++;
    return count;
  }, [searchTerm, classFilter, genderFilter, serialFrom, serialTo]);

  // Clear filters
  const handleClearFilters = () => {
    setSearchTerm('');
    setClassFilter('All');
    setGenderFilter('All');
    setSerialFrom('');
    setSerialTo('');
    setCurrentPage(1);
  };

  // --- PAGINATION LOGIC ---
  const paginatedStudents = useMemo(() => {
    if (rowsPerPage === 'all') return filteredStudents;
    const start = (currentPage - 1) * rowsPerPage;
    return filteredStudents.slice(start, start + rowsPerPage);
  }, [filteredStudents, currentPage, rowsPerPage]);

  const totalPages = useMemo(() => {
    if (rowsPerPage === 'all') return 1;
    return Math.ceil(filteredStudents.length / rowsPerPage) || 1;
  }, [filteredStudents, rowsPerPage]);

  const startIdx = useMemo(() => {
    return (currentPage - 1) * (typeof rowsPerPage === 'number' ? rowsPerPage : 0) + 1;
  }, [currentPage, rowsPerPage]);

  const endIdx = useMemo(() => {
    if (rowsPerPage === 'all') return filteredStudents.length;
    return Math.min(currentPage * rowsPerPage, filteredStudents.length);
  }, [currentPage, rowsPerPage, filteredStudents]);

  // Reset pagination on filter bounds
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, classFilter, genderFilter, serialFrom, serialTo, rowsPerPage]);

  // --- SELECTION CONTROL ---
  const isAllSelected = useMemo(() => {
    if (paginatedStudents.length === 0) return false;
    return paginatedStudents.every(s => selectedIds.has(s.id));
  }, [paginatedStudents, selectedIds]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const updated = new Set(selectedIds);
    if (e.target.checked) {
      paginatedStudents.forEach(s => updated.add(s.id));
    } else {
      paginatedStudents.forEach(s => updated.delete(s.id));
    }
    setSelectedIds(updated);
  };

  const handleSelectToggle = (id: string) => {
    const updated = new Set(selectedIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedIds(updated);
  };

  // --- SORT CONTROL ---
  const triggerSort = (column: keyof Student) => {
    if (activeSort.column === column) {
      setActiveSort({
        column,
        order: activeSort.order === 'asc' ? 'desc' : 'asc'
      });
    } else {
      setActiveSort({
        column,
        order: 'asc'
      });
    }
  };

  // --- FORM VALIDATION HELPERS ---
  const validateForm = (isEditing: boolean = false): boolean => {
    const errors: Record<string, string> = {};
    
    // Name
    if (!formName.trim()) {
      errors.name = "Full name is required";
    }

    // Email
    if (!formEmail.trim() || !formEmail.includes('@')) {
      errors.email = "Please enter a valid email containing '@'";
    } else {
      // Uniqueness check
      const dup = students.find(s => 
        s.email.toLowerCase() === formEmail.trim().toLowerCase() && 
        (!isEditing || s.id !== selectedStudent?.id)
      );
      if (dup) {
        errors.email = "Email is already taken by student serial " + dup.classSN;
      }
    }

    // Phone (Optional, Nigerian format validation)
    if (formPhone.trim()) {
      const cleaned = formPhone.replace(/\s+/g, '');
      const pattern = /^(070|080|090|081|071|091|080|081)\d{8}$/;
      if (!pattern.test(cleaned) || cleaned.length !== 11) {
        errors.phone = "Must be a valid 11-digit Nigerian number (starting with 070/080/090/081)";
      }
    }

    // Serial
    const serialPattern = /^[AB]\d+$/i;
    if (!formSerial.trim() || !serialPattern.test(formSerial.trim())) {
      errors.classSN = `Must match format A# (Class A) or B# (Class B)`;
    } else {
      // Validate class matching prefix
      const expectedClass = formSerial.toUpperCase().startsWith('A') ? 'Class A' : 'Class B';
      if (expectedClass !== formClass) {
        errors.classSN = `Serial prefix must match the selected Class (${formClass === 'Class A' ? 'A' : 'B'})`;
      }
      
      // Serial uniqueness
      const dup = students.find(s => 
        s.classSN.toUpperCase() === formSerial.trim().toUpperCase() && 
        (!isEditing || s.id !== selectedStudent?.id)
      );
      if (dup) {
        errors.classSN = "Serial code is already assigned to: " + dup.name;
      }
    }

    setFormFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Auto transforms on changes
  const applyNameTransform = (val: string) => {
    // Title Case Name
    const transformed = val.replace(/\b\w/g, c => c.toUpperCase());
    setFormName(transformed);
  };

  // --- ACTIONS ---
  const handleOpenAddModal = () => {
    setFormName('');
    setFormEmail('');
    setFormPhone('');
    setFormGender('');
    setFormClass('Class A');
    setFormSerial('A');
    setFormFieldErrors({});
    setIsAddModalOpen(true);
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm(false)) return;

    try {
      const studentData = {
        name: formName.trim(),
        email: formEmail.trim().toLowerCase(),
        phone: formPhone.trim() || undefined,
        gender: formGender || undefined,
        class: formClass,
        classSN: formSerial.trim().toUpperCase()
      };

      const result = await DB.addStudent(studentData);
      
      await triggerAuditLog(
        `Added Student profile ${result.classSN} (${result.name})`,
        'Manage Students',
        null,
        result,
        "Admin interface manual profile addition"
      );

      setIsAddModalOpen(false);
      fetchData();
    } catch (err) {
      alert("Error adding student: " + err);
    }
  };

  const handleOpenEditModal = (student: Student) => {
    setSelectedStudent(student);
    setFormName(student.name);
    setFormEmail(student.email);
    setFormPhone(student.phone || '');
    setFormGender(student.gender || '');
    setFormClass(student.class);
    setFormSerial(student.classSN);
    setFormFieldErrors({});
    setIsEditModalOpen(true);
  };

  const handleUpdateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;
    if (!validateForm(true)) return;

    // Changes warnings
    const classChanged = formClass !== selectedStudent.class;
    const serialChanged = formSerial.toUpperCase() !== selectedStudent.classSN;

    const executeUpdate = async () => {
      try {
        const patch = {
          name: formName.trim(),
          email: formEmail.trim().toLowerCase(),
          phone: formPhone.trim() || undefined,
          gender: formGender || undefined,
          class: formClass,
          classSN: formSerial.trim().toUpperCase()
        };

        const result = await DB.updateStudent(selectedStudent.id, patch);

        await triggerAuditLog(
          `Updated Student Profile ${result.classSN}`,
          'Manage Students',
          selectedStudent,
          result,
          `Changes made: Name/Meta (Class change: ${classChanged}, Code Change: ${serialChanged})`
        );

        setIsEditModalOpen(false);
        fetchData();
        
        // Refresh detail panel if it's open for this student
        if (panelStudent?.id === selectedStudent.id) {
          handleOpenSidePanel(result);
        }
      } catch (err) {
        alert("Error saving: " + err);
      }
    };

    if (classChanged || serialChanged) {
      const promptText = `Warning:\n` +
        (classChanged ? `- Changing Class will impact attendance matching.\n` : '') +
        (serialChanged ? `- Changing Serial code from ${selectedStudent.classSN} to ${formSerial.toUpperCase()} will affect historical records.\n` : '') +
        `Do you want to apply these structural changes?`;
      
      if (confirm(promptText)) {
        executeUpdate();
      }
    } else {
      executeUpdate();
    }
  };

  const handleDeleteIndividual = (student: Student) => {
    protectionPasswordConfirm(`Delete student ${student.classSN} (${student.name})`, async () => {
      try {
        const res = await confirmAction({
          title: 'Delete student profile',
          description: 'Permanently removes this student and cascades the deletion to every attendance record and exam result linked to their email.',
          scope: [
            `Name: ${student.name}`,
            `Serial: ${student.classSN}`,
            `Class: ${student.class}`,
            `Email: ${student.email}`,
            'All attendance records for this email will be removed',
            'All exam results for this email will be removed',
          ],
          confirmLabel: 'Delete student',
          requireTypedConfirm: 'DELETE',
          requireReason: true,
          reasonPlaceholder: 'Required for the secure audit log…',
        });
        if (!res.confirmed) return;
        const reason = res.reason!;

        await DB.deleteStudent(student.id);

        const recs = await DB.getAttRecords();
        const recordsToKeep = recs.filter(r => r.email.toLowerCase() !== student.email.toLowerCase());
        await localStorage.setItem('cbt_att_records', JSON.stringify(recordsToKeep));

        const resList = await DB.getResults();
        const resToKeep = resList.filter(r => r.email.toLowerCase() !== student.email.toLowerCase());
        await localStorage.setItem('cbt_results', JSON.stringify(resToKeep));

        await triggerAuditLog(
          `Deleted student profile ${student.classSN} (${student.name}) and computed and cascaded linked tables`,
          'Manage Students',
          student,
          null,
          reason
        );

        fetchData();
        setIsSidePanelOpen(false);
      } catch (err) {
        alert("Delete error: " + err);
      }
    });
  };

  // --- BULK ACTIONS SYSTEM-WIDE (Requirement A5, D1) ---
  const handleBulkMove = (targetClass: 'Class A' | 'Class B') => {
    if (selectedIds.size === 0) return;
    
    protectionPasswordConfirm(`Bulk move ${selectedIds.size} student(s) to ${targetClass}`, async () => {
      const reason = prompt(`Enter reason to move ${selectedIds.size} student(s) to ${targetClass}:`);
      if (!reason) return;

      const updatedList = students.map(student => {
        if (selectedIds.has(student.id)) {
          // Keep prefix aligned or warn
          const newSnPrefix = targetClass === 'Class A' ? 'A' : 'B';
          const numericPart = student.classSN.match(/\d+/)?.[0] || '1';
          return {
            ...student,
            class: targetClass,
            classSN: `${newSnPrefix}${numericPart}`,
            updatedAt: new Date().toISOString()
          };
        }
        return student;
      });

      await DB.setStudents(updatedList);
      await triggerAuditLog(
        `Bulk moved ${selectedIds.size} students to ${targetClass}`,
        'Manage Students',
        null,
        { movedCount: selectedIds.size, targetClass },
        reason
      );

      setSelectedIds(new Set());
      fetchData();
    });
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;

    protectionPasswordConfirm(`Bulk delete ${selectedIds.size} student(s)`, async () => {
      const selectedList = students.filter(s => selectedIds.has(s.id));
      const previewNames = selectedList.slice(0, 5).map(s => `${s.classSN} — ${s.name}`);
      if (selectedList.length > 5) previewNames.push(`…and ${selectedList.length - 5} more`);

      const res = await confirmAction({
        title: `Bulk delete ${selectedIds.size} student(s)`,
        description: 'A JSON backup of the selected students will be downloaded first, then all matching attendance records and exam results will be cascade-deleted.',
        scope: [
          `${selectedIds.size} student profile(s) will be removed`,
          ...previewNames,
          'Linked attendance records will be removed',
          'Linked exam results will be removed',
        ],
        confirmLabel: 'Delete selected',
        requireTypedConfirm: 'DELETE',
        requireReason: true,
        reasonPlaceholder: 'Destruction reason (logged to audit)…',
      });
      if (!res.confirmed) return;
      const reason = res.reason!;

      // 1. Generate Backup
      const backupData = selectedList;
      const filename = `backup-students-bulk-delete-${new Date().toISOString().slice(0, 10)}.json`;
      downloadBackupJSON(backupData, filename);

      // 2. Execute deletion
      const keptStudents = students.filter(s => !selectedIds.has(s.id));
      const backupEmails = backupData.map(b => b.email.toLowerCase());

      await DB.setStudents(keptStudents);

      // Cascade deletes
      const recs = await DB.getAttRecords();
      const keptRecords = recs.filter(r => !backupEmails.includes(r.email.toLowerCase()));
      localStorage.setItem('cbt_att_records', JSON.stringify(keptRecords));

      const resList = await DB.getResults();
      const keptResults = resList.filter(r => !backupEmails.includes(r.email.toLowerCase()));
      localStorage.setItem('cbt_results', JSON.stringify(keptResults));

      await triggerAuditLog(
        `Bulk deleted ${selectedIds.size} students. JSON Backup downloaded: ${filename}`,
        'Manage Students',
        backupData,
        null,
        reason
      );

      setSelectedIds(new Set());
      fetchData();
    });
  };

  const handleWipeAllStudents = () => {
    protectionPasswordConfirm("DESTROY AND WIPE ALL STUDENT RECORDS", async () => {
      const res = await confirmAction({
        title: 'Wipe ALL student records',
        description: 'Irreversibly clears every student plus every attendance record, edit request, exam result, and eligibility row in local storage. A JSON backup is downloaded first.',
        scope: [
          `${students.length} student profile(s) will be wiped`,
          'All attendance records will be cleared',
          'All attendance edit requests will be cleared',
          'All exam results will be cleared',
          'All exam eligibility rows will be cleared',
          'A JSON backup is auto-downloaded before deletion',
        ],
        confirmLabel: 'Wipe everything',
        requireTypedConfirm: 'WIPE ALL',
        requireReason: true,
        reasonPlaceholder: 'Central audit log reason for absolute wipe-all…',
      });
      if (!res.confirmed) return;
      const reason = res.reason!;

      // Generate backup first!
      const filename = `backup-all-students-${new Date().toISOString().split('T')[0]}.json`;
      downloadBackupJSON(students, filename);

      // Clear all
      await DB.setStudents([]);
      localStorage.setItem('cbt_att_records', '[]');
      localStorage.setItem('cbt_att_edit_requests', '[]');
      localStorage.setItem('cbt_results', '[]');
      localStorage.setItem('cbt_exam_eligibility', '[]');

      await triggerAuditLog(
        `PERMANENTLY WIPED ALL ${students.length} STUDENTS. Auto-downloaded backup ${filename}`,
        'Manage Students',
        students,
        null,
        reason
      );

      fetchData();
    });
  };


  const downloadBackupJSON = (data: any, name: string) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", name);
    dlAnchorElem.click();
    dlAnchorElem.remove();
  };

  // --- CSV EXPORT ---
  const handleExportCSV = (scope: 'all' | 'filtered') => {
    const targetData = scope === 'all' ? students : filteredStudents;
    if (targetData.length === 0) {
      alert("No student data to export.");
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Name,Email,Phone,Gender,Class,Serial No\n";

    targetData.forEach(s => {
      const row = [
        `"${s.name.replace(/"/g, '""')}"`,
        `"${s.email}"`,
        `"${s.phone || ''}"`,
        `"${s.gender || ''}"`,
        `"${s.class}"`,
        `"${s.classSN}"`
      ].join(",");
      csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `students_${scope}_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();

    triggerAuditLog(
      `Exported ${targetData.length} students to CSV (${scope} list)`,
      'Manage Students',
      null,
      null,
      "Manual directory CSV download export request"
    );
  };

  // --- RECONCILE STUDENT DETAILS SIDE PANEL (Slide-in right panel) ---
  const handleOpenSidePanel = async (student: Student) => {
    setPanelStudent(student);
    setIsSidePanelOpen(true);

    // Fetch student attendance records and metrics
    const [records, results] = await Promise.all([
      DB.getRecordsByStudent(student.email),
      DB.getResults()
    ]);

    const activeResults = results.filter(r => r.email.toLowerCase() === student.email.toLowerCase());
    const matchedResult = activeResults.length > 0 ? activeResults[0] : null;

    // Filter sessions to see what meetings count
    const totalSessions = records.length;
    const present = records.filter(r => r.status === 'present').length;
    const late = records.filter(r => r.status === 'late').length;
    const absent = records.filter(r => r.status === 'absent').length;
    const pct = totalSessions > 0 ? Math.round(((present + late) / totalSessions) * 100) : 0;

    // Last 20 status histories (for dot trend)
    const sortedHist = [...records]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20);

    setPanelAttendance({
      total: totalSessions,
      present,
      late,
      absent,
      pct,
      history: sortedHist.reverse() // ordered left -> right: chronologically ascending
    });

    setPanelExam(matchedResult);
  };

  // --- REPORT CARD PDF DOWNLOADER (Requirement F8) ---
  const generatePDFReportCard = (student: Student) => {
    const doc = new jsPDF();
    
    // Header styling
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text("TechRise Training Cohort 3", 105, 20, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text("LEARNFACTORY NIGERIA — SECURE ASSESSMENT PORTAL", 105, 26, { align: 'center' });
    
    // Draw horizontal separator
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(15, 30, 195, 30);
    
    // Personal Details Grid
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.setFont("Helvetica", "bold");
    doc.text("STUDENT REPORT CARD", 15, 42);
    
    // Detail Card background
    doc.setFillColor(248, 250, 252);
    doc.rect(15, 47, 180, 32, "F");
    
    doc.setFontSize(10);
    doc.setFont("Helvetica", "bold");
    doc.text("Full Name:", 20, 54);
    doc.text("Student Email:", 20, 61);
    doc.text("Phone Number:", 20, 68);
    doc.text("Gender Status:", 20, 74);
    
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(student.name, 50, 54);
    doc.text(student.email, 50, 61);
    doc.text(student.phone || "—", 50, 68);
    doc.text(student.gender || "Not Specified", 50, 74);
    
    doc.setFont("Helvetica", "bold");
    doc.text("Assigned Class:", 120, 54);
    doc.text("Class Serial No:", 120, 61);
    doc.text("Generated At:", 120, 68);
    
    doc.setFont("Helvetica", "normal");
    doc.text(student.class, 155, 54);
    doc.text(student.classSN, 155, 61);
    doc.text(new Date().toLocaleString(), 155, 68);
    
    // SECTION 1: ATTENDANCE BLOCK
    doc.setFontSize(12);
    doc.setFont("Helvetica", "bold");
    doc.text("1. Cumulative Attendance Summary", 15, 92);
    
    doc.setFillColor(241, 245, 249);
    doc.rect(15, 96, 180, 16, "F");
    
    doc.setFontSize(9);
    doc.setFont("Helvetica", "bold");
    doc.text("Total Sessions", 22, 102);
    doc.text("Checked Present", 62, 102);
    doc.text("Late Arrivals", 102, 102);
    doc.text("Absent Days", 137, 102);
    doc.text("Attendance %", 167, 102);
    
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`${panelAttendance.total}`, 22, 109);
    doc.text(`${panelAttendance.present}`, 62, 109);
    doc.text(`${panelAttendance.late}`, 102, 109);
    doc.text(`${panelAttendance.absent}`, 137, 109);
    doc.text(`${panelAttendance.pct}%`, 167, 109);
    
    // SECTION 2: EXAM METRICS
    doc.setFontSize(12);
    doc.setFont("Helvetica", "bold");
    doc.text("2. Secure CBT Exam Records", 15, 124);
    
    if (panelExam) {
      // Table grid
      doc.setFillColor(248, 250, 252);
      doc.rect(15, 128, 180, 35, "F");
      
      doc.setFontSize(10);
      doc.text("Assessment Title:", 19, 134);
      doc.text("Attempt ID (Idempotency Key):", 19, 141);
      doc.text("Submitted Timestamp:", 19, 148);
      doc.text("Total Scaled Score:", 19, 155);
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(10);
      doc.text("CBT Midterm Certification Examination", 75, 134);
      doc.text(panelExam.attemptId || panelExam.id, 75, 141);
      doc.text(new Date(panelExam.submittedAt).toLocaleString(), 75, 148);
      
      doc.setFont("Helvetica", "bold");
      const grade = panelExam.percentage >= 75 ? 'A (Excellent)' : panelExam.percentage >= 50 ? 'C (Pass)' : 'F (Fail)';
      doc.text(`${panelExam.score} / ${panelExam.totalQuestions}  (${panelExam.percentage}%)  —  Grade: ${grade}`, 75, 155);
    } else {
      doc.setFillColor(254, 242, 242);
      doc.setDrawColor(252, 165, 165);
      doc.rect(15, 128, 180, 16, "FD");
      
      doc.setFontSize(10);
      doc.setTextColor(185, 28, 28);
      doc.text("NO SECURE SUMMATIVE EXAM RECORD COMPLETED FOR THIS STUDENT.", 20, 138);
    }
    
    // Footnote & verification stamp
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.text("This report card represents secure evaluation live records audited server-side on Supabase RLS.", 105, 185, { align: 'center' });
    doc.text("CryoBytePrime Assessment Proctor Engine v2.4.1", 105, 190, { align: 'center' });
    
    // Download trigger
    doc.save(`report-card-${student.classSN}-${student.name.replace(/\s+/g, "_")}.pdf`);
    
    triggerAuditLog(
      `Downloaded PDF Report Card for ${student.classSN} (${student.name})`,
      'Manage Students',
      null,
      null,
      "Admin compiled PDF export"
    );
  };

  // --- CSV IMPORT MANAGE MODAL (Requirement D2) ---
  const handleCSVDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleCSVDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processCSVFile(files[0]);
    }
  };

  const handleCSVFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processCSVFile(files[0]);
    }
  };

  const processCSVFile = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      alert("Only standard .csv files are supported.");
      return;
    }
    setImportFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      parseAndPreviewCSV(text);
    };
    reader.readAsText(file);
  };

  const parseAndPreviewCSV = (text: string) => {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) {
      alert("CSV file seems empty");
      return;
    }

    // Capture header row: find row containing "name"
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes('name')) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      alert("Invalid CSV format. Header line must contain 'name' and map to properties.");
      return;
    }

    const headers = lines[headerIdx].split(',').map(h => h.trim().toLowerCase());
    
    // Map indices with robust variations
    const nameColIdx = headers.findIndex(h => h === 'name' || h === 'full name' || h === 'fullname' || h === 'student name' || h === 'student_name');
    let firstNameColIdx = headers.findIndex(h => h.includes('first') && h.includes('name'));
    if (firstNameColIdx === -1) {
      firstNameColIdx = headers.findIndex(h => h === 'firstname' || h === 'first');
    }
    let lastNameColIdx = headers.findIndex(h => h.includes('last') && h.includes('name'));
    if (lastNameColIdx === -1) {
      lastNameColIdx = headers.findIndex(h => h === 'lastname' || h === 'last');
    }

    const emailColIdx = headers.findIndex(h => h.includes('email') || h === 'mail');
    const phoneColIdx = headers.findIndex(h => h.includes('phone') || h.includes('mobile') || h.includes('contact') || h === 'tel');
    const genderColIdx = headers.findIndex(h => h.includes('gender') || h === 'sex');
    const classColIdx = headers.findIndex(h => h.includes('class') && !h.includes('sn') && !h.includes('serial'));
    const classSnColIdx = headers.findIndex(h => 
      h.includes('classsn') || h.includes('serial') || h.includes('class_sn') || h.includes('classun') || h.includes('sn')
    );

    let finalNameColIdx = nameColIdx;
    if (finalNameColIdx === -1 && firstNameColIdx === -1) {
      finalNameColIdx = headers.findIndex(h => h.includes('name'));
    }

    if ((finalNameColIdx === -1 && firstNameColIdx === -1) || emailColIdx === -1) {
      alert("CSV headers missing required fields: 'Name' (or 'First Name') and 'Email'. Received: " + lines[headerIdx]);
      return;
    }

    const previews: any[] = [];
    const usedEmails = new Set(students.map(s => s.email.toLowerCase()));
    const usedSerials = new Set(students.map(s => s.classSN.toUpperCase()));

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle simple comma separation (handle potential quotes in future robust split)
      const cells = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
      if (cells.length < 2) continue;

      let inlineName = '';
      if (firstNameColIdx !== -1 && lastNameColIdx !== -1) {
        const first = cells[firstNameColIdx] || '';
        const last = cells[lastNameColIdx] || '';
        if (last && last.toLowerCase() !== 'null') {
          inlineName = `${first} ${last}`.trim();
        } else {
          inlineName = first;
        }
      } else if (finalNameColIdx !== -1) {
        inlineName = cells[finalNameColIdx] || '';
      }

      const inlineEmail = cells[emailColIdx] || '';
      const inlinePhone = phoneColIdx !== -1 ? cells[phoneColIdx] || '' : '';
      const inlineGender = genderColIdx !== -1 ? cells[genderColIdx] || '' : '';
      const inlineClassRaw = classColIdx !== -1 ? cells[classColIdx] || '' : '';
      const inlineSerialRaw = classSnColIdx !== -1 ? cells[classSnColIdx] || '' : '';

      // Auto resolve class validation
      let inlineClass: 'Class A' | 'Class B' = 'Class A';
      if (inlineClassRaw.toLowerCase().includes('b') || inlineSerialRaw.toUpperCase().startsWith('B')) {
        inlineClass = 'Class B';
      }

      // Check serial format
      let inlineSerial = inlineSerialRaw.toUpperCase() || '';
      if (!inlineSerial) {
        // Auto assign serial number draft based on class size
        const idxClass = previews.filter(p => p.class === inlineClass).length + 1;
        const prefix = inlineClass === 'Class A' ? 'A' : 'B';
        const numStart = inlineClass === 'Class A' ? stats.classA : stats.classB;
        inlineSerial = `${prefix}${numStart + idxClass}`;
      }

      // Validations badges
      let status: 'New' | 'Duplicate' | 'Invalid' = 'New';
      let errorMsg = '';

      if (!inlineName) {
        status = 'Invalid';
        errorMsg = 'Name is missing';
      } else if (!inlineEmail || !inlineEmail.includes('@')) {
        status = 'Invalid';
        errorMsg = 'Invalid email address';
      } else if (usedEmails.has(inlineEmail.toLowerCase())) {
        status = 'Duplicate';
        errorMsg = 'Email already exists or is duplicated in file';
      } else if (usedSerials.has(inlineSerial)) {
        status = 'Duplicate';
        errorMsg = `Serial ${inlineSerial} already taken`;
      }

      if (status === 'New') {
        usedEmails.add(inlineEmail.toLowerCase());
        usedSerials.add(inlineSerial);
      }

      previews.push({
        id: 'csv_' + i,
        name: inlineName.replace(/\b\w/g, c => c.toUpperCase()),
        email: inlineEmail.toLowerCase(),
        phone: inlinePhone || undefined,
        gender: inlineGender ? (inlineGender.toLowerCase().startsWith('m') ? 'Male' : 'Female') : '',
        class: inlineClass,
        classSN: inlineSerial,
        status,
        errorMsg,
        checked: status === 'New'
      });
    }

    setImportedRows(previews);
    setImportStep(2);
  };

  const handleToggleImportRow = (id: string) => {
    setImportedRows(prev => prev.map(r => r.id === id ? { ...r, checked: !r.checked } : r));
  };

  const handleExecuteImport = async () => {
    const rowsToImport = importedRows.filter(r => r.checked && r.status === 'New');
    if (rowsToImport.length === 0) {
      alert("No valid rows selected for import.");
      return;
    }

    const studentsToAppend: Student[] = rowsToImport.map(r => ({
      id: 'student_' + Math.random().toString(36).substr(2, 9),
      name: r.name,
      email: r.email,
      phone: r.phone,
      gender: r.gender,
      class: r.class,
      classSN: r.classSN,
      createdAt: new Date().toISOString()
    }));

    try {
      const fullList = [...students, ...studentsToAppend];
      await DB.setStudents(fullList);

      setImportSummary({
        success: studentsToAppend.length,
        skip: importedRows.filter(r => r.status === 'Duplicate').length,
        invalid: importedRows.filter(r => r.status === 'Invalid' || !r.checked).length
      });

      await triggerAuditLog(
        `Imported ${studentsToAppend.length} students from CSV ${importFileName}`,
        'Manage Students',
        null,
        { count: studentsToAppend.length, filename: importFileName },
        "Roster upload spreadsheet confirmation"
      );

      setImportStep(3);
      fetchData();
    } catch (err: any) {
      console.error("CSV Bulk Import error:", err);
      alert("⚠️ Database Sync Failed: " + (err.message || "An unresolved error occurred during batch insertion. Please check your Supabase schema or network connection."));
    }
  };

  // --- RENDER ---
  return (
    <div id="students-module-root" className="space-y-6">
      
      {/* HEADER CONTROLS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center space-x-2">
            <Users className="w-6 h-6 text-cyan-600" />
            <span>Student Management Directory</span>
          </h2>
          <p className="text-xs text-slate-500">
            Configure student cohorts, serial boundaries, and generate analytical assessment cards.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleWipeAllStudents}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-slate-200 transition-colors flex items-center space-x-1.5 cursor-pointer"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Wipe All Students</span>
          </button>

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-250 hover:bg-slate-50 shadow-sm transition-colors flex items-center space-x-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            <span>Import CSV</span>
          </button>

          <div className="relative group">
            <button
              onClick={() => handleExportCSV('all')}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-250 hover:bg-slate-50 shadow-sm transition-colors flex items-center space-x-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export CSV</span>
            </button>
            {activeFiltersCount > 0 && (
              <button
                onClick={() => handleExportCSV('filtered')}
                className="absolute left-0 -top-7 whitespace-nowrap bg-cyan-600 text-white font-mono text-[9px] font-bold py-0.5 px-2 rounded-md animate-bounce cursor-pointer shadow-md"
              >
                Export Filtered ({filteredStudents.length})
              </button>
            )}
          </div>

          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-600 hover:bg-cyan-700 text-white shadow-sm flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Student</span>
          </button>
        </div>
      </div>

      {/* SUMMARY STATS ROW */}
      <div id="student-stats-bar" className="grid grid-cols-2 md:grid-cols-6 gap-3.5 bg-slate-900 text-white rounded-2xl p-4 border border-slate-800 shadow-sm font-sans">
        <div className="space-y-0.5 px-1">
          <p className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Total Directory</p>
          <p className="text-xl font-bold font-mono tracking-tight text-cyan-400">{stats.total}</p>
        </div>
        <div className="space-y-0.5 border-l border-slate-800 pl-3">
          <p className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Class A Size</p>
          <p className="text-xl font-bold font-mono tracking-tight text-slate-200">{stats.classA}</p>
        </div>
        <div className="space-y-0.5 border-l border-slate-800 pl-3">
          <p className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Class B Size</p>
          <p className="text-xl font-bold font-mono tracking-tight text-slate-200">{stats.classB}</p>
        </div>
        <div className="space-y-0.5 border-l border-slate-800 pl-3 col-span-1">
          <p className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Male Count</p>
          <p className="text-xl font-bold font-mono tracking-tight text-slate-350">{stats.male}</p>
        </div>
        <div className="space-y-0.5 border-l border-slate-800 pl-3 col-span-1">
          <p className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Female Count</p>
          <p className="text-xl font-bold font-mono tracking-tight text-pink-400">{stats.female}</p>
        </div>
        <div className="space-y-0.5 border-l border-slate-800 pl-3 col-span-1">
          <p className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Gender Not Set</p>
          <p className="text-xl font-bold font-mono tracking-tight text-slate-500">{stats.noGender}</p>
        </div>
      </div>

      {/* FILTER PANEL */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold uppercase text-slate-500 font-mono">Filter Configuration</span>
            {activeFiltersCount > 0 && (
              <span className="bg-cyan-50 text-cyan-700 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-cyan-100 font-mono">
                Active ({activeFiltersCount})
              </span>
            )}
          </div>
          {activeFiltersCount > 0 && (
            <button
              onClick={handleClearFilters}
              className="text-xs font-semibold text-cyan-600 hover:text-cyan-700 font-sans cursor-pointer hover:underline"
            >
              Clear Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Search bar */}
          <div className="md:col-span-4 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by student name, email, serial..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs pl-10 pr-4 py-2.5 rounded-xl border border-slate-250 bg-slate-50/50 focus:outline-none focus:border-cyan-500 focus:bg-white transition-all font-sans"
            />
          </div>

          {/* Class Filter */}
          <div className="md:col-span-2">
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-250 bg-slate-50 focus:outline-none focus:border-cyan-500 focus:bg-white transition-all text-slate-700 font-bold cursor-pointer"
            >
              <option value="All">All Classes</option>
              <option value="Class A">Class A Only</option>
              <option value="Class B">Class B Only</option>
            </select>
          </div>

          {/* Gender Filter */}
          <div className="md:col-span-2">
            <select
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-250 bg-slate-50 focus:outline-none focus:border-cyan-500 focus:bg-white transition-all text-slate-700 font-bold cursor-pointer"
            >
              <option value="All">All Genders</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Not Set">Not Set</option>
            </select>
          </div>

          {/* Serial code range boundary — dropdowns scoped to available serials */}
          {(() => {
            const availableSerials = Array.from(
              new Set(
                students
                  .filter(s => classFilter === 'All' || s.class === classFilter)
                  .map(s => (s.classSN || '').toUpperCase())
                  .filter(Boolean)
              )
            ).sort((a, b) => naturalSort(a, b));
            return (
              <div className="md:col-span-4 flex items-center space-x-2">
                <div className="grow relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] font-mono font-bold text-slate-400 z-10 pointer-events-none">FROM:</span>
                  <select
                    value={serialFrom}
                    onChange={(e) => setSerialFrom(e.target.value)}
                    className="w-full text-xs font-mono pl-11 pr-2 py-2 rounded-xl border border-slate-250 bg-slate-50/50 uppercase cursor-pointer focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">Any</option>
                    {availableSerials.map(sn => (
                      <option key={sn} value={sn}>{sn}</option>
                    ))}
                  </select>
                </div>
                <span className="text-slate-400 text-xs font-bold">—</span>
                <div className="grow relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] font-mono font-bold text-slate-400 z-10 pointer-events-none">TO:</span>
                  <select
                    value={serialTo}
                    onChange={(e) => setSerialTo(e.target.value)}
                    className="w-full text-xs font-mono pl-8 pr-2 py-2 rounded-xl border border-slate-250 bg-slate-50/50 uppercase cursor-pointer focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">Any</option>
                    {availableSerials.map(sn => (
                      <option key={sn} value={sn}>{sn}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* CORE STUDENT TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full border-collapse text-left relative">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[10px] tracking-wider font-mono font-bold uppercase sticky top-0 z-10">
              <tr>
                <th className="p-3 w-10 text-center bg-slate-50">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                    className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                  />
                </th>
                <th className="p-3.5 w-12 text-center bg-slate-50">#</th>
                <th className="p-3.5 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => triggerSort('name')}>
                  <div className="flex items-center space-x-1">
                    <span>Full Name</span>
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </th>
                <th className="p-3.5 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => triggerSort('email')}>
                  <div className="flex items-center space-x-1">
                    <span>Email Address</span>
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </th>
                <th className="p-3.5 bg-slate-50">Phone Number</th>
                <th className="p-3.5 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => triggerSort('gender')}>
                  <div className="flex items-center space-x-1">
                    <span>Gender</span>
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </th>
                <th className="p-3.5 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => triggerSort('class')}>
                  <div className="flex items-center space-x-1">
                    <span>Class</span>
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </th>
                <th className="p-3.5 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => triggerSort('classSN')}>
                  <div className="flex items-center space-x-1">
                    <span>Serial No.</span>
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </th>
                <th className="p-3.5 bg-slate-50 text-right pr-6">Actions</th>
              </tr>
            </thead>
            
            <tbody className="divide-y divide-slate-150 text-xs font-sans text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-20 text-center font-mono text-slate-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-cyan-500" />
                    <span>Loading student directory profiles...</span>
                  </td>
                </tr>
              ) : paginatedStudents.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-20 text-center text-slate-400 font-medium">
                    No active student directories matching selected criteria.
                  </td>
                </tr>
              ) : (
                paginatedStudents.map((student, index) => {
                  const isSelected = selectedIds.has(student.id);
                  const displayIndex = startIdx + index;
                  return (
                    <tr 
                      key={student.id} 
                      className={`hover:bg-slate-50/70 transition-colors group ${
                        isSelected ? 'bg-cyan-500/5' : 'even:bg-slate-50/20'
                      }`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectToggle(student.id)}
                          className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                        />
                      </td>
                      <td className="p-3.5 text-center font-mono text-[10px] text-slate-400 font-bold">
                        {displayIndex}
                      </td>
                      <td className="p-3.5 font-bold text-slate-900">
                        <button
                          onClick={() => handleOpenSidePanel(student)}
                          className="hover:text-cyan-600 hover:underline text-left font-sans font-bold transition-all focus:outline-none cursor-pointer"
                        >
                          {student.name}
                        </button>
                      </td>
                      <td className="p-3.5 font-mono text-slate-550 lowercase">
                        <a href={`mailto:${student.email}`} className="hover:text-cyan-600 hover:underline">
                          {student.email}
                        </a>
                      </td>
                      <td className="p-3.5 text-slate-600 font-mono tracking-tight">
                        {student.phone || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="p-3.5">
                        {student.gender === 'Male' ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">
                            Male
                          </span>
                        ) : student.gender === 'Female' ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-50 text-pink-700 border border-pink-100">
                            Female
                          </span>
                        ) : (
                          <span className="text-slate-300 font-medium">—</span>
                        )}
                      </td>
                      <td className="p-3.5">
                        {student.class === 'Class A' ? (
                          <span className="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 text-blue-700 border border-blue-100 font-mono">
                            Class A
                          </span>
                        ) : (
                          <span className="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-cyan-50 text-cyan-700 border border-cyan-100 font-mono">
                            Class B
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 font-mono font-black">
                        <span className="bg-slate-100 px-2.5 py-0.5 rounded-md text-slate-800 tracking-tight border border-slate-200">
                          {student.classSN}
                        </span>
                      </td>
                      <td className="p-3.5 text-right pr-6">
                        <div className="flex items-center justify-end space-x-1">
                          <button
                            onClick={() => handleOpenEditModal(student)}
                            className="p-1.5 text-slate-500 hover:text-cyan-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="Edit Profile"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteIndividual(student)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete Student"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION PANEL FOOTER */}
        {!loading && filteredStudents.length > 0 && (
          <div className="bg-slate-50 border-t border-slate-200 px-4 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
            <div className="font-semibold text-slate-500 font-mono">
              Showing {startIdx} to {endIdx} of {filteredStudents.length} students 
              {activeFiltersCount > 0 && " (filtered from " + students.length + ")"}
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <span className="text-slate-500">Rows per page:</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    const val = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
                    setRowsPerPage(val);
                    setCurrentPage(1);
                  }}
                  className="bg-white border border-slate-250 py-1.5 px-2.5 rounded-lg text-slate-700 font-bold focus:outline-none"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value="all">Show All</option>
                </select>
              </div>

              {rowsPerPage !== 'all' && totalPages > 1 && (
                <div className="flex items-center space-x-1.5">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(currentPage - 1)}
                    className="p-1.5 rounded-lg bg-white border border-slate-250 hover:bg-slate-50 disabled:opacity-40 transition-opacity cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono font-bold px-2 text-slate-600">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(currentPage + 1)}
                    className="p-1.5 rounded-lg bg-white border border-slate-250 hover:bg-slate-50 disabled:opacity-40 transition-opacity cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* STICKY BOTTOM BULK BAR (Requirement A5, D1) */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-800 text-white shadow-2xl rounded-2xl px-5 py-4 flex items-center justify-between space-x-5.5 z-40 animate-slide-up max-w-[90vw]">
          <div className="flex items-center space-x-3">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping"></span>
            <span className="text-xs font-mono font-bold">
              <strong className="text-cyan-300 font-extrabold">{selectedIds.size}</strong> Students Selected
            </span>
          </div>

          <div className="flex items-center space-x-2 border-l border-slate-800 pl-4.5">
            <button
              onClick={() => handleExportCSV('filtered')}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-xs font-semibold select-none cursor-pointer transition-colors"
            >
              Export Selected
            </button>
            
            <button
              onClick={() => handleBulkMove('Class A')}
              className="px-3 py-1.5 rounded-lg bg-blue-950 hover:bg-blue-900 text-blue-300 text-xs font-semibold select-none cursor-pointer transition-colors"
            >
              Move to Class A
            </button>

            <button
              onClick={() => handleBulkMove('Class B')}
              className="px-3 py-1.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 text-cyan-300 text-xs font-semibold select-none cursor-pointer transition-colors"
            >
              Move to Class B
            </button>

            <button
              onClick={handleBulkDelete}
              className="px-3 py-1.5 rounded-lg bg-rose-955 hover:bg-rose-900 text-rose-300 text-xs font-semibold select-none cursor-pointer transition-colors flex items-center space-x-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Selected</span>
            </button>

            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ADD STUDENT MODAL (Controlled) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden animate-zoom-in">
            <div className="bg-slate-50 border-b border-slate-150 px-5 py-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-1.5">
                <Users className="w-4 h-4 text-cyan-600" />
                <span>Register New Student Profile</span>
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateStudent} className="p-5 space-y-4">
              {/* Full Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Full Name (Required)</label>
                <input
                  type="text"
                  placeholder="e.g. Joy Imenya"
                  value={formName}
                  onChange={(e) => applyNameTransform(e.target.value)}
                  className={`w-full text-xs p-3 rounded-lg border ${
                    formFieldErrors.name ? 'border-rose-400 focus:border-rose-500' : 'border-slate-250 focus:border-cyan-500'
                  } focus:outline-none`}
                  required
                />
                {formFieldErrors.name && (
                  <p className="text-[10px] text-rose-600 font-medium">{formFieldErrors.name}</p>
                )}
              </div>

              {/* Email Address */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Email Address (Required)</label>
                <input
                  type="email"
                  placeholder="name@email.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className={`w-full text-xs p-3 rounded-lg border ${
                    formFieldErrors.email ? 'border-rose-400 focus:border-rose-500' : 'border-slate-250 focus:border-cyan-500'
                  } focus:outline-none`}
                  required
                />
                {formFieldErrors.email && (
                  <p className="text-[10px] text-rose-600 font-medium">{formFieldErrors.email}</p>
                )}
              </div>

              {/* Grid 2x2 for Phone + Gender and Class + Serial */}
              <div className="grid grid-cols-2 gap-3.5">
                {/* Phone */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Nigerian Phone</label>
                  <input
                    type="text"
                    placeholder="08012345678"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className={`w-full text-xs p-3 rounded-lg border ${
                      formFieldErrors.phone ? 'border-rose-400 focus:border-rose-500' : 'border-slate-250 focus:border-cyan-500'
                    } focus:outline-none`}
                  />
                  {formFieldErrors.phone ? (
                    <p className="text-[10px] text-rose-600 font-medium leading-tight">{formFieldErrors.phone}</p>
                  ) : (
                    <p className="text-[9px] text-slate-400">Nigerian 11-digit structure</p>
                  )}
                </div>

                {/* Gender Segmented buttons */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Gender Option</label>
                  <div className="grid grid-cols-3 bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setFormGender('Male')}
                      className={`py-1 text-center text-[11px] font-bold rounded-md ${
                        formGender === 'Male' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-550'
                      }`}
                    >
                      Male
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormGender('Female')}
                      className={`py-1 text-center text-[11px] font-bold rounded-md ${
                        formGender === 'Female' ? 'bg-white text-pink-700 shadow-sm' : 'text-slate-555'
                      }`}
                    >
                      Female
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormGender('')}
                      className={`py-1 text-center text-[11px] font-bold rounded-md ${
                        formGender === '' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-550'
                      }`}
                    >
                      None
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3.5 pt-1.5">
                {/* Class */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Class Stream</label>
                  <select
                    value={formClass}
                    onChange={(e) => {
                      const sel = e.target.value as 'Class A' | 'Class B';
                      setFormClass(sel);
                      // Pre-fill corresponding prefix A or B in serial code if untouched
                      if (formSerial === 'A' || formSerial === 'B' || formSerial === '' || formSerial.length < 2) {
                        setFormSerial(sel === 'Class A' ? 'A' : 'B');
                      }
                    }}
                    className="w-full text-xs p-3 rounded-lg border border-slate-250 bg-slate-50"
                  >
                    <option value="Class A">Class A</option>
                    <option value="Class B">Class B</option>
                  </select>
                </div>

                {/* Serial SN */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Serial Code (Unique)</label>
                  <input
                    type="text"
                    placeholder="e.g. A45 or B44"
                    value={formSerial}
                    onChange={(e) => setFormSerial(e.target.value.toUpperCase())}
                    className={`w-full text-xs font-mono p-3 rounded-lg border ${
                      formFieldErrors.classSN ? 'border-rose-400 focus:border-rose-500' : 'border-slate-250 focus:border-cyan-500'
                    } focus:outline-none uppercase`}
                    required
                  />
                  {formFieldErrors.classSN && (
                    <p className="text-[10px] text-rose-600 font-medium leading-tight">{formFieldErrors.classSN}</p>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-150 p-3 rounded-xl flex items-start space-x-2 text-[10px] text-slate-550 leading-relaxed mt-2">
                <AlertCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>
                  The serial profile governs attendance check-in and CBT exam authorization. Double check code before saving.
                </span>
              </div>

              {/* CTA Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold shadow-sm cursor-pointer"
                >
                  Register Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT STUDENT MODAL */}
      {isEditModalOpen && selectedStudent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden animate-zoom-in">
            <div className="bg-slate-50 border-b border-slate-150 px-5 py-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-1.5">
                <Edit className="w-4 h-4 text-cyan-600" />
                <span>Modify Student Profile ({selectedStudent.classSN})</span>
              </h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateStudent} className="p-5 space-y-4">
              {/* Full Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Full Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => applyNameTransform(e.target.value)}
                  className={`w-full text-xs p-3 rounded-lg border ${
                    formFieldErrors.name ? 'border-rose-400 focus:border-rose-500' : 'border-slate-250 focus:border-cyan-500'
                  } focus:outline-none`}
                  required
                />
                {formFieldErrors.name && (
                  <p className="text-[10px] text-rose-600 font-medium">{formFieldErrors.name}</p>
                )}
              </div>

              {/* Email */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Email Address</label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className={`w-full text-xs p-3 rounded-lg border ${
                    formFieldErrors.email ? 'border-rose-400 focus:border-rose-500' : 'border-slate-250 focus:border-cyan-500'
                  } focus:outline-none`}
                  required
                />
                {formFieldErrors.email && (
                  <p className="text-[10px] text-rose-600 font-medium">{formFieldErrors.email}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                {/* Phone */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Nigerian Phone</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className={`w-full text-xs p-3 rounded-lg border ${
                      formFieldErrors.phone ? 'border-rose-400 focus:border-rose-500' : 'border-slate-250 focus:border-cyan-500'
                    } focus:outline-none`}
                  />
                  {formFieldErrors.phone && (
                    <p className="text-[10px] text-rose-600 font-medium leading-tight">{formFieldErrors.phone}</p>
                  )}
                </div>

                {/* Gender */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Gender Option</label>
                  <div className="grid grid-cols-3 bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setFormGender('Male')}
                      className={`py-1 text-center text-[11px] font-bold rounded-md ${
                        formGender === 'Male' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-550'
                      }`}
                    >
                      Male
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormGender('Female')}
                      className={`py-1 text-center text-[11px] font-bold rounded-md ${
                        formGender === 'Female' ? 'bg-white text-pink-700 shadow-sm' : 'text-slate-555'
                      }`}
                    >
                      Female
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormGender('')}
                      className={`py-1 text-center text-[11px] font-bold rounded-md ${
                        formGender === '' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-550'
                      }`}
                    >
                      None
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3.5 pt-1.5">
                {/* Class */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Class Stream</label>
                  <select
                    value={formClass}
                    onChange={(e) => setFormClass(e.target.value as 'Class A' | 'Class B')}
                    className="w-full text-xs p-3 rounded-lg border border-slate-250 bg-slate-50"
                  >
                    <option value="Class A">Class A</option>
                    <option value="Class B">Class B</option>
                  </select>
                </div>

                {/* Serial SN */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold font-mono text-slate-500 uppercase">Serial Code</label>
                  <input
                    type="text"
                    value={formSerial}
                    onChange={(e) => setFormSerial(e.target.value.toUpperCase())}
                    className={`w-full text-xs font-mono p-3 rounded-lg border ${
                      formFieldErrors.classSN ? 'border-rose-400 focus:border-rose-500' : 'border-slate-250 focus:border-cyan-500'
                    } focus:outline-none uppercase`}
                    required
                  />
                  {formFieldErrors.classSN && (
                    <p className="text-[10px] text-rose-600 font-medium leading-tight">{formFieldErrors.classSN}</p>
                  )}
                </div>
              </div>

              {/* Structural Warnings */}
              {(formClass !== selectedStudent.class || formSerial !== selectedStudent.classSN) && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] rounded-xl flex items-start space-x-2 leading-relaxed">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
                  <span>
                    Warning: Changing Class or Serial ID will require re-mapping of previous attendance records and exam marks. Proceed with caution.
                  </span>
                </div>
              )}

              {/* SAVE BUTTONS */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold shadow-sm cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV IMPORT MODAL FLOW */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[85vh] animate-zoom-in">
            {/* Modal Header */}
            <div className="bg-slate-50 border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-2">
                <FileSpreadsheet className="w-4 h-4 text-cyan-600" />
                <span>Bulk CSV Import Roster Flow</span>
              </h3>
              <button 
                onClick={() => {
                  setIsImportModalOpen(false);
                  setImportStep(1);
                  setImportedRows([]);
                }} 
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step Indicators */}
            <div className="bg-slate-100 border-b border-slate-200 px-5 py-2.5 flex items-center space-x-6 text-[10px] font-mono font-bold text-slate-400 select-none">
              <span className={importStep === 1 ? "text-cyan-600 border-b-2 border-cyan-500 pb-0.5" : "text-slate-500"}>1. UPLOAD CSV FILE</span>
              <span>&gt;</span>
              <span className={importStep === 2 ? "text-cyan-600 border-b-2 border-cyan-500 pb-0.5" : "text-slate-500"}>2. AUDIT PREVIEW</span>
              <span>&gt;</span>
              <span className={importStep === 3 ? "text-cyan-600 border-b-2 border-cyan-500 pb-0.5" : "text-slate-500"}>3. COMPILATION RESULT</span>
            </div>

            {/* STEP 1 CONTENT */}
            {importStep === 1 && (
              <div className="p-10 text-center space-y-6">
                <div 
                  onDragOver={handleCSVDragOver}
                  onDrop={handleCSVDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-250 hover:border-cyan-500 rounded-2xl p-12 bg-slate-50/50 hover:bg-slate-50 transition-all cursor-pointer flex flex-col items-center justify-center space-y-3.5 group"
                >
                  <div className="w-12 h-12 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 group-hover:bg-white group-hover:text-cyan-600 shadow-sm transition-all">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">Drag & Drop student sheet or browse files</p>
                    <p className="text-[10px] text-slate-400 mt-1 font-mono">Accepts .csv format sheets only</p>
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleCSVFileSelect}
                    accept=".csv"
                    className="hidden"
                  />
                </div>

                <div className="max-w-md mx-auto text-left space-y-1.5 border border-slate-150 p-4 rounded-xl bg-slate-50/20">
                  <span className="text-[9px] font-black tracking-wider uppercase text-slate-500 font-mono">Acknowledge Schema Layout:</span>
                  <p className="text-[10px] leading-relaxed text-slate-550">
                    Your CSV headers will be case-insensitive matched against: <code className="bg-slate-100 px-1 py-0.5 rounded text-cyan-600 font-mono">name</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-cyan-600 font-mono">email</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-cyan-600 font-mono">phone</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-cyan-600 font-mono">gender</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-cyan-600 font-mono">class</code>, <code className="bg-slate-105 px-1 py-0.5 rounded text-cyan-600 font-mono">classSN</code>.
                  </p>
                </div>
              </div>
            )}

            {/* STEP 2 CONTENT */}
            {importStep === 2 && (
              <div className="grow overflow-hidden flex flex-col min-h-0">
                <div className="p-4 bg-slate-50 border-b border-slate-150 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Previewing rows parsing from {importFileName}:</span>
                  <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-500">
                    <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-green-500"></span> <span>Valid: {importedRows.filter(r => r.status === 'New').length}</span></span>
                    <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-yellow-500"></span> <span>Duplicate: {importedRows.filter(r => r.status === 'Duplicate').length}</span></span>
                    <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> <span>Invalid: {importedRows.filter(r => r.status === 'Invalid').length}</span></span>
                  </div>
                </div>

                <div className="overflow-y-auto grow p-3 divide-y divide-slate-150 max-h-[50vh]">
                  <table className="w-full text-left text-xs border-collapse font-sans">
                    <thead className="bg-slate-50 text-[10px] font-mono uppercase text-slate-500 sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="p-2.5 w-8"></th>
                        <th className="p-2.5">Name</th>
                        <th className="p-2.5">Email</th>
                        <th className="p-2.5">Gender</th>
                        <th className="p-2.5">Class Target</th>
                        <th className="p-2.5">Mapped SN</th>
                        <th className="p-2.5">Preview State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 text-slate-600 font-sans">
                      {importedRows.map((row) => (
                        <tr key={row.id} className={`hover:bg-slate-50 ${!row.checked && 'opacity-65'}`}>
                          <td className="p-2.5 text-center">
                            {row.status === 'New' && (
                              <input
                                type="checkbox"
                                checked={row.checked}
                                onChange={() => handleToggleImportRow(row.id)}
                                className="rounded text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                              />
                            )}
                          </td>
                          <td className="p-2.5 font-bold text-slate-900">{row.name}</td>
                          <td className="p-2.5 font-mono text-[11px]">{row.email}</td>
                          <td className="p-2.5">{row.gender || "—"}</td>
                          <td className="p-2.5 font-mono">{row.class}</td>
                          <td className="p-2.5 font-mono font-bold">{row.classSN}</td>
                          <td className="p-2.5">
                            {row.status === 'New' ? (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-50 text-green-700 border border-green-100">🟢 New Import</span>
                            ) : row.status === 'Duplicate' ? (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold bg-yellow-50 text-yellow-700 border border-yellow-105" title={row.errorMsg}>🟡 Skipped (Duplicate)</span>
                            ) : (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-105" title={row.errorMsg}>🔴 Skipped (Error)</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="bg-slate-50 border-t border-slate-200 p-4 flex items-center justify-between">
                  <button
                    onClick={() => {
                      setImportStep(1);
                      setImportedRows([]);
                    }}
                    className="px-4 py-2 border border-slate-250 bg-white rounded-lg text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-50"
                  >
                    Back to Upload
                  </button>

                  <button
                    onClick={handleExecuteImport}
                    className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold cursor-pointer transition-colors shadow-md"
                  >
                    Confirm & Batch Import Selected ({importedRows.filter(r => r.checked && r.status === 'New').length} rows)
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3 CONTENT */}
            {importStep === 3 && (
              <div className="p-8 text-center space-y-6 select-none">
                <div className="w-14 h-14 rounded-full bg-green-100 border border-green-200 flex items-center justify-center text-green-700 mx-auto animate-bounce">
                  <Check className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-wide">Roster Sheet Compiled Successfully!</h4>
                  <p className="text-xs text-slate-500 mt-1">Student profiles have been written back to client-memory</p>
                </div>

                <div className="grid grid-cols-3 max-w-sm mx-auto gap-3.5 bg-slate-50 p-4 border border-slate-150 rounded-2xl select-none">
                  <div>
                    <p className="text-xl font-bold font-mono text-green-600">+{importSummary.success}</p>
                    <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider mt-0.5">Written</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold font-mono text-amber-600">{importSummary.skip}</p>
                    <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider mt-0.5">Skipped</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold font-mono text-rose-500">{importSummary.invalid}</p>
                    <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider mt-0.5">Invalid</p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setIsImportModalOpen(false);
                    setImportStep(1);
                    setImportedRows([]);
                  }}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-950 rounded-xl text-white text-xs font-bold cursor-pointer transition-all shadow-md"
                >
                  Return to Dashboard
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* STUDENT DETAILS SLIDE-IN SIDE PANEL */}
      {isSidePanelOpen && panelStudent && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-end z-40 animate-fade-in select-none">
          {/* Overlay click to close */}
          <div className="absolute inset-0" onClick={() => setIsSidePanelOpen(false)}></div>

          <div className="relative bg-white border-l border-slate-200 shadow-2xl max-w-lg w-full h-full flex flex-col z-10 animate-slide-left p-6 space-y-6 overflow-y-auto">
            {/* Header controls */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <span className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-widest">Student Report Profile</span>
              <button onClick={() => setIsSidePanelOpen(false)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Profile summary profile card */}
            <div className="space-y-3 p-4 bg-slate-50 border border-slate-150 rounded-2xl relative overflow-hidden">
              <span className="absolute top-2.5 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black tracking-tight bg-slate-200 border border-slate-300">
                {panelStudent.classSN}
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900 leading-tight">{panelStudent.name}</h3>
                <p className="text-xs text-slate-500 font-mono">{panelStudent.email}</p>
                {panelStudent.phone && <p className="text-xs text-slate-500 font-mono mt-0.5">{panelStudent.phone}</p>}
              </div>

              <div className="flex space-x-1.5 pt-1">
                {panelStudent.class === 'Class A' ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-blue-50 text-blue-700 font-mono">Class A Roster</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-cyan-50 text-cyan-700 font-mono">Class B Roster</span>
                )}
                {panelStudent.gender && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-200 text-slate-700">{panelStudent.gender}</span>
                )}
              </div>
            </div>

            {/* Attendance tracking stats */}
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase text-slate-600 tracking-wider">Attendance Cumulative Records</h4>
                <div className="flex items-center space-x-1">
                  <span className="text-xs font-bold text-slate-500 font-mono">STANDING:</span>
                  {panelAttendance.total > 0 ? (
                    getStanding(panelAttendance.pct) === 'good' ? (
                      <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded-md font-mono text-[10px] font-bold">GOOD</span>
                    ) : getStanding(panelAttendance.pct) === 'risk' ? (
                      <span className="px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded-md font-mono text-[10px] font-bold">AT RISK</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-rose-50 text-rose-705 rounded-md font-mono text-[10px] font-bold">POOR</span>
                    )
                  ) : (
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md font-mono text-[10px] font-bold">—</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2.5">
                <div className="bg-slate-50 border border-slate-150 p-2.5 rounded-xl text-center">
                  <p className="text-xs text-slate-400 font-mono">Sessions</p>
                  <p className="text-lg font-bold font-mono mt-0.5">{panelAttendance.total}</p>
                </div>
                <div className="bg-slate-50 border border-slate-150 p-2.5 rounded-xl text-center">
                  <p className="text-xs text-green-600 font-mono">Present</p>
                  <p className="text-lg font-bold font-mono text-green-600 mt-0.5">{panelAttendance.present}</p>
                </div>
                <div className="bg-slate-50 border border-slate-150 p-2.5 rounded-xl text-center">
                  <p className="text-xs text-yellow-600 font-mono">Late</p>
                  <p className="text-lg font-bold font-mono text-yellow-600 mt-0.5">{panelAttendance.late}</p>
                </div>
                <div className="bg-slate-50 border border-slate-150 p-2.5 rounded-xl text-center">
                  <p className="text-xs text-rose-500 font-mono">Absent</p>
                  <p className="text-lg font-bold font-mono text-rose-500 mt-0.5">{panelAttendance.absent}</p>
                </div>
              </div>

              {/* Attendance percentage indicator */}
              {panelAttendance.total > 0 && (
                <div className="space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-150">
                  <div className="flex items-center justify-between text-[11px] font-medium">
                    <span className="text-slate-500">Attendance Ratio:</span>
                    <span className="font-bold font-mono text-slate-800">{panelAttendance.pct}% Required Range: (&gt;= 75%)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        panelAttendance.pct >= 75 ? 'bg-green-500' : panelAttendance.pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${panelAttendance.pct}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* Trend dot timeline of latest 20 sessions */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-500 font-mono uppercase tracking-wider">Attendance Dot Timeline (Last 20 Sessions):</p>
                <div className="flex flex-wrap items-center gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-200 min-h-11">
                  {panelAttendance.history.length === 0 ? (
                    <span className="text-[10px] text-slate-400 font-medium">No recorded session history.</span>
                  ) : (
                    panelAttendance.history.map((h, i) => (
                      <span 
                        key={h.id || i}
                        className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-[8px] font-black pointer-events-none select-none text-white ${
                          h.status === 'present' ? 'bg-green-500' : h.status === 'late' ? 'bg-amber-500' : 'bg-red-500'
                        }`}
                        title={`${h.date}: ${h.status.toUpperCase()}`}
                      >
                        {h.status[0].toUpperCase()}
                      </span>
                    ))
                  )}
                </div>
                <div className="flex items-center space-x-3 text-[9px] font-mono text-slate-450 pt-0.5">
                  <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-green-500"></span> <span>Present</span></span>
                  <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span> <span>Late</span></span>
                  <span className="flex items-center space-x-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> <span>Absent</span></span>
                </div>
              </div>
            </div>

            {/* Exam Results Card */}
            <div className="space-y-3.5">
              <h4 className="text-xs font-black uppercase text-slate-600 tracking-wider">Summative Exam Performance</h4>
              {panelExam ? (
                <div className="bg-slate-900 text-white rounded-2xl p-4 border border-slate-800 space-y-4 shadow-sm relative overflow-hidden">
                  <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/20"></div>
                  
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">Secure CBT Attempt</p>
                      <h5 className="text-xs font-bold text-slate-200 mt-0.5">Midterm Certificate Examination</h5>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                      panelExam.percentage >= 75 ? 'bg-green-500/20 text-green-300' : panelExam.percentage >= 50 ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-350'
                    }`}>
                      {panelExam.percentage >= 75 ? 'PASSED (EXCELLENT)' : panelExam.percentage >= 50 ? 'PASSED' : 'FAILED'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-3">
                    <div>
                      <p className="text-[9px] font-mono text-slate-400 uppercase tracking-widest">Total Score</p>
                      <p className="text-lg font-bold font-mono tracking-tight text-slate-100">{panelExam.score} / {panelExam.totalQuestions}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono text-slate-400 uppercase tracking-widest font-bold">Weighted Percent</p>
                      <p className="text-lg font-bold font-mono tracking-tight text-cyan-400">{panelExam.percentage}%</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start space-x-2.5">
                  <AlertCircle className="w-5 h-5 shrink-0 text-amber-500" />
                  <div>
                    <h5 className="font-bold">Pending Exam Submission</h5>
                    <p className="text-slate-550 leading-relaxed mt-0.5 text-[11px]">
                      This student has not yet submitted their secure assessment session or is currently locked out by attendance rules.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer triggers */}
            <div className="grow flex items-end justify-between pt-6 border-t border-slate-100 gap-2">
              <button
                onClick={() => handleDeleteIndividual(panelStudent)}
                className="px-3.5 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 text-xs font-bold transition-all flex items-center space-x-1 mr-auto"
                title="Wipe Student Profile"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Student</span>
              </button>

              <button
                onClick={() => generatePDFReportCard(panelStudent)}
                className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold shadow-sm transition-all flex items-center space-x-1.5 cursor-pointer"
                title="Export Student Record card"
              >
                <Download className="w-4 h-4" />
                <span>Download Report PDF</span>
              </button>

              <button
                onClick={() => handleOpenEditModal(panelStudent)}
                className="px-4 py-2.5 rounded-xl border border-slate-250 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold shadow-sm transition-colors cursor-pointer"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
