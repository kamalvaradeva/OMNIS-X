/**
 * OMNIS-X — Intelligent Campus Recovery System
 * Inbuilt Synthetic Institutional Data & Conflict-Free Weekly Timetable
 *
 * Entities:
 * - 5 Engineering Departments
 * - 50 Faculty Members (10 per department)
 * - 1,200 Students grouped into 20 Sections (4 per department)
 * - 25 Classrooms across campus blocks & power zones
 * - 10 Specialized Laboratories (2 per department)
 * - 8 Campus Buses with commuting faculty & student mappings
 * - 4 Hostels (Boys & Girls)
 * - 5 Examinations, 3 Placement Drives, 3 Institutional Events, 5 Administrative Resources
 * - Deterministic conflict-free weekly timetable across Mon-Fri x 5 Slots
 */

(function (global) {
  'use strict';

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const OPERATING_HOURS = { startTime: '09:00', endTime: '15:30', startMin: 540, endMin: 930 };
  const SLOTS = [
    { id: 'S1', label: '09:00 - 10:00', period: 'Morning', isMorning: true, startTime: '09:00', endTime: '10:00', startMin: 540, endMin: 600 },
    { id: 'S2', label: '10:00 - 11:00', period: 'Morning', isMorning: true, startTime: '10:00', endTime: '11:00', startMin: 600, endMin: 660 },
    { id: 'S3', label: '11:15 - 12:15', period: 'Midday', isMorning: false, startTime: '11:15', endTime: '12:15', startMin: 675, endMin: 735 },
    { id: 'S4', label: '13:30 - 14:30', period: 'Afternoon', isMorning: false, startTime: '13:30', endTime: '14:30', startMin: 810, endMin: 870 },
    { id: 'S5', label: '14:30 - 15:30', period: 'Afternoon', isMorning: false, startTime: '14:30', endTime: '15:30', startMin: 870, endMin: 930 }
  ];

  function toISODate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseISODate(isoStr) {
    const [y, m, d] = String(isoStr).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function formatDateDMY(isoStr) {
    if (!isoStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return String(isoStr || '');
    const [y, m, d] = isoStr.split('-');
    return `${d}/${m}/${y}`;
  }

  function getWeekdayName(isoStr) {
    if (!isoStr) return '';
    return WEEKDAY_NAMES[parseISODate(isoStr).getDay()];
  }

  function getSimulationReferenceWeek(anchor = new Date()) {
    const base = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const dayIdx = base.getDay(); // 0=Sun..6=Sat
    const diffToMon = dayIdx === 0 ? -6 : 1 - dayIdx;
    const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() + diffToMon);
    const map = {};
    DAYS.forEach((dayName, idx) => {
      const dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + idx);
      map[dayName] = toISODate(dt);
    });
    return map;
  }

  const DEPARTMENTS = [
    { id: 'DEPT-CSE', code: 'CSE', name: 'Computer Science & Engineering', headId: 'FAC-01', block: 'Block A', color: '#2563eb' },
    { id: 'DEPT-ECE', code: 'ECE', name: 'Electronics & Communication Engg.', headId: 'FAC-11', block: 'Block B', color: '#7c3aed' },
    { id: 'DEPT-ME', code: 'ME', name: 'Mechanical Engineering', headId: 'FAC-21', block: 'Block C', color: '#0d9488' },
    { id: 'DEPT-CE', code: 'CE', name: 'Civil Engineering', headId: 'FAC-31', block: 'Block D', color: '#d97706' },
    { id: 'DEPT-EEE', code: 'EEE', name: 'Electrical & Electronics Engg.', headId: 'FAC-41', block: 'Block E', color: '#db2777' }
  ];

  // 25 Subjects: 5 per department (3 theory lectures + 2 practical labs)
  const SUBJECTS = [
    // CSE
    { id: 'SUB-CSE-1', code: 'CS301', name: 'Data Structures & Algorithms', department: 'CSE', type: 'lecture', labType: null, credits: 4 },
    { id: 'SUB-CSE-2', code: 'CS302', name: 'Operating Systems', department: 'CSE', type: 'lecture', labType: null, credits: 4 },
    { id: 'SUB-CSE-3', code: 'CS303', name: 'Database Management Systems', department: 'CSE', type: 'lecture', labType: null, credits: 3 },
    { id: 'SUB-CSE-4', code: 'CS304L', name: 'Systems & Networks Lab', department: 'CSE', type: 'lab', labType: 'computing', credits: 2 },
    { id: 'SUB-CSE-5', code: 'CS305L', name: 'AI & Cloud Computing Lab', department: 'CSE', type: 'lab', labType: 'computing', credits: 2 },

    // ECE
    { id: 'SUB-ECE-1', code: 'EC301', name: 'Digital Signal Processing', department: 'ECE', type: 'lecture', labType: null, credits: 4 },
    { id: 'SUB-ECE-2', code: 'EC302', name: 'VLSI Circuit Design', department: 'ECE', type: 'lecture', labType: null, credits: 4 },
    { id: 'SUB-ECE-3', code: 'EC303', name: 'Embedded Microcontrollers', department: 'ECE', type: 'lecture', labType: null, credits: 3 },
    { id: 'SUB-ECE-4', code: 'EC304L', name: 'VLSI & Embedded Lab', department: 'ECE', type: 'lab', labType: 'electronics', credits: 2 },
    { id: 'SUB-ECE-5', code: 'EC305L', name: 'RF & Communication Lab', department: 'ECE', type: 'lab', labType: 'electronics', credits: 2 },

    // ME
    { id: 'SUB-ME-1', code: 'ME301', name: 'Engineering Thermodynamics', department: 'ME', type: 'lecture', labType: null, credits: 4 },
    { id: 'SUB-ME-2', code: 'ME302', name: 'Fluid Mechanics & Machines', department: 'ME', type: 'lecture', labType: null, credits: 4 },
    { id: 'SUB-ME-3', code: 'ME303', name: 'Machine Design & Dynamics', department: 'ME', type: 'lecture', labType: null, credits: 3 },
    { id: 'SUB-ME-4', code: 'ME304L', name: 'Thermal & Fluids Lab', department: 'ME', type: 'lab', labType: 'mechanical', credits: 2 },
    { id: 'SUB-ME-5', code: 'ME305L', name: 'CAD / CAM Robotics Lab', department: 'ME', type: 'lab', labType: 'mechanical', credits: 2 },

    // CE
    { id: 'SUB-CE-1', code: 'CE301', name: 'Structural Analysis', department: 'CE', type: 'lecture', labType: null, credits: 4 },
    { id: 'SUB-CE-2', code: 'CE302', name: 'Geotechnical Engineering', department: 'CE', type: 'lecture', labType: null, credits: 4 },
    { id: 'SUB-CE-3', code: 'CE303', name: 'Transportation Systems', department: 'CE', type: 'lecture', labType: null, credits: 3 },
    { id: 'SUB-CE-4', code: 'CE304L', name: 'Concrete & Materials Lab', department: 'CE', type: 'lab', labType: 'civil', credits: 2 },
    { id: 'SUB-CE-5', code: 'CE305L', name: 'Geomatics & CAD Lab', department: 'CE', type: 'lab', labType: 'civil', credits: 2 },

    // EEE
    { id: 'SUB-EEE-1', code: 'EE301', name: 'Power System Analysis', department: 'EEE', type: 'lecture', labType: null, credits: 4 },
    { id: 'SUB-EEE-2', code: 'EE302', name: 'Control Systems Engineering', department: 'EEE', type: 'lecture', labType: null, credits: 4 },
    { id: 'SUB-EEE-3', code: 'EE303', name: 'Power Electronics & Drives', department: 'EEE', type: 'lecture', labType: null, credits: 3 },
    { id: 'SUB-EEE-4', code: 'EE304L', name: 'High Voltage & Machines Lab', department: 'EEE', type: 'lab', labType: 'electrical', credits: 2 },
    { id: 'SUB-EEE-5', code: 'EE305L', name: 'Smart Grid Simulation Lab', department: 'EEE', type: 'lab', labType: 'electrical', credits: 2 }
  ];

  // 50 Faculty Names (10 per department)
  const FACULTY_NAMES = [
    // CSE (FAC-01..FAC-10)
    'Dr. Arvind Menon', 'Dr. Kavita Nair', 'Prof. Rohan Kulkarni', 'Dr. Sneha Iyer', 'Prof. Vikramaditya Rao',
    'Dr. Meera Deshmukh', 'Prof. Siddharth Joshi', 'Dr. Ananya Chatterjee', 'Prof. Karthik Subramanian', 'Dr. Neha Kapoor',
    // ECE (FAC-11..FAC-20)
    'Dr. Rajeshwar Pillai', 'Dr. Pooja Venkatesh', 'Prof. Aditya Malhotra', 'Dr. Divya Krishnan', 'Prof. Harshvardhan Sen',
    'Dr. Nandini Bhat', 'Prof. Pranav Gokhale', 'Dr. Shreya Banerjee', 'Prof. Manish Tiwari', 'Dr. Swati Agrawal',
    // ME (FAC-21..FAC-30)
    'Dr. Suresh Babu', 'Dr. Rekha Choudhary', 'Prof. Nikhil Verma', 'Dr. Gayatri Kulkarni', 'Prof. Deepak Chauhan',
    'Dr.Pallavi Deshpande', 'Prof.VarunSaxena', 'Dr. Ashwini Patil', 'Prof. Tarun Mehta', 'Dr. Sunita Reddy',
    // CE (FAC-31..FAC-40)
    'Dr. Mahendra Hegde', 'Dr. Vandana Mishra', 'Prof. Abhishek Sharma', 'Dr.Bhavna Joshi', 'Prof. Gaurav Tripathi',
    'Dr. Kritika Bose', 'Prof. Sandeep Yadav', 'Dr. Ritika Nambiar', 'Prof. Vivek Ranjan', 'Dr. Shalini Gupta',
    // EEE (FAC-41..FAC-50)
    'Dr. Krishnanunni V.', 'Dr. Madhuri Gokhale', 'Prof. Saurabh Jain', 'Dr. Priyanka Das', 'Prof. Ankur Srivastava',
    'Dr. Lavanya Prasad', 'Prof. Devendra Singh', 'Dr. Tanvi Phadke', 'Prof. Rakesh Nair', 'Dr. Aparna Krishnan'
  ].map((n) => n.replace('Dr.Pallavi', 'Dr. Pallavi').replace('Prof.VarunSaxena', 'Prof. Varun Saxena').replace('Dr.Bhavna', 'Dr. Bhavna'));

  const DESIGNATIONS = [
    'Professor & HOD', 'Professor', 'Associate Professor', 'Associate Professor', 'Assistant Professor',
    'Associate Professor', 'Assistant Professor', 'Assistant Professor', 'Assistant Professor', 'Assistant Professor'
  ];

  const BUS_ASSIGNED_FACULTY = {
    0: 'BUS-01', 2: 'BUS-01', 6: 'BUS-02', 9: 'BUS-03',
    11: 'BUS-02', 14: 'BUS-04', 17: 'BUS-05', 19: 'BUS-01',
    22: 'BUS-03', 24: 'BUS-06', 27: 'BUS-04', 29: 'BUS-07',
    32: 'BUS-05', 34: 'BUS-08', 36: 'BUS-06', 38: 'BUS-02',
    42: 'BUS-07', 44: 'BUS-08', 46: 'BUS-03', 48: 'BUS-04'
  };

  function buildFaculty() {
    const deptCodes = ['CSE', 'ECE', 'ME', 'CE', 'EEE'];
    const faculty = [];
    for (let i = 0; i < 50; i++) {
      const deptIdx = Math.floor(i / 10);
      const localIdx = i % 10;
      const dept = deptCodes[deptIdx];
      const deptSubjects = SUBJECTS.filter((s) => s.department === dept).map((s) => s.id);
      // Every faculty is qualified for at least 3-4 subjects in their dept so recovery has genuine choices
      const qualSet = new Set();
      qualSet.add(deptSubjects[localIdx % 3]);
      qualSet.add(deptSubjects[(localIdx + 1) % 3]);
      qualSet.add(deptSubjects[3 + (localIdx % 2)]);
      // Senior faculty (localIdx < 5) are qualified for all 3 theory subjects; even indices also cover both labs
      if (localIdx < 4) {
        deptSubjects.forEach((s) => qualSet.add(s));
      } else if (localIdx % 2 === 0) {
        qualSet.add(deptSubjects[3]);
        qualSet.add(deptSubjects[4]);
      }

      const id = `FAC-${String(i + 1).padStart(2, '0')}`;
      faculty.push({
        id,
        name: FACULTY_NAMES[i],
        department: dept,
        designation: DESIGNATIONS[localIdx],
        qualifications: Array.from(qualSet),
        maxWeeklyLoad: localIdx < 2 ? 12 : localIdx < 5 ? 14 : 16,
        busId: BUS_ASSIGNED_FACULTY[i] || null,
        isHostelWarden: localIdx === 1 && deptIdx < 4 ? `HST-0${deptIdx + 1}` : null,
        status: 'operational'
      });
    }
    return faculty;
  }

  // 20 Sections: 4 per department, sizes [55, 60, 60, 65] -> 240 per dept * 5 = 1,200 students
  function buildSections() {
    const deptCodes = ['CSE', 'ECE', 'ME', 'CE', 'EEE'];
    const sizes = [55, 60, 60, 65];
    const semesters = [3, 5, 5, 7];
    const sections = [];
    let idx = 0;
    for (let d = 0; d < deptCodes.length; d++) {
      const dept = deptCodes[d];
      for (let s = 0; s < 4; s++) {
        const num = s + 1;
        const busPrimary = `BUS-0${((idx) % 8) + 1}`;
        const busSecondary = `BUS-0${((idx + 3) % 8) + 1}`;
        const hostelId = `HST-0${((idx) % 4) + 1}`;
        const studentCount = sizes[s];
        const busCommuters = Math.round(studentCount * 0.45);
        const hostelResidents = studentCount - busCommuters;
        sections.push({
          id: `SEC-${dept}-${num}`,
          name: `${dept} Section ${String.fromCharCode(64 + num)}`,
          department: dept,
          semester: semesters[s],
          studentCount,
          busIds: [busPrimary, busSecondary],
          busCommuters,
          hostelId,
          hostelResidents,
          status: 'operational'
        });
        idx++;
      }
    }
    return sections;
  }

  // 25 Classrooms across Blocks A-E & Exam Wing, linked to Power Zones PZ-1..PZ-3
  function buildClassrooms() {
    const rooms = [];
    const blocks = ['Block A', 'Block B', 'Block C', 'Block D', 'Block E'];
    const capacities = [60, 65, 65, 70, 80];
    // First 20 classrooms: 4 per block (CR-01..CR-20)
    for (let i = 0; i < 20; i++) {
      const b = Math.floor(i / 4);
      const r = (i % 4) + 1;
      const cap = capacities[r % capacities.length];
      rooms.push({
        id: `CR-${String(i + 1).padStart(2, '0')}`,
        name: `${blocks[b]} LH-${b + 1}0${r}`,
        block: blocks[b],
        department: ['CSE', 'ECE', 'ME', 'CE', 'EEE'][b],
        capacity: cap,
        type: 'lecture',
        hasProjector: true,
        powerZone: b < 2 ? 'PZ-1' : b < 4 ? 'PZ-2' : 'PZ-3',
        status: 'operational'
      });
    }
    // 5 Examination & Seminar Halls (CR-21..CR-25)
    const specialRooms = [
      { id: 'CR-21', name: 'Exam Hall Alpha', block: 'Exam Wing', department: 'CENTRAL', capacity: 80, type: 'exam-hall', powerZone: 'PZ-1' },
      { id: 'CR-22', name: 'Exam Hall Beta', block: 'Exam Wing', department: 'CENTRAL', capacity: 80, type: 'exam-hall', powerZone: 'PZ-2' },
      { id: 'CR-23', name: 'Exam Hall Gamma', block: 'Exam Wing', department: 'CENTRAL', capacity: 70, type: 'exam-hall', powerZone: 'PZ-2' },
      { id: 'CR-24', name: 'Turing Auditorium', block: 'Placement Wing', department: 'CENTRAL', capacity: 140, type: 'auditorium', powerZone: 'PZ-1' },
      { id: 'CR-25', name: 'Visvesvaraya Seminar Hall', block: 'Placement Wing', department: 'CENTRAL', capacity: 120, type: 'auditorium', powerZone: 'PZ-3' }
    ];
    specialRooms.forEach((sr) => {
      rooms.push({
        ...sr,
        hasProjector: true,
        status: 'operational'
      });
    });
    return rooms;
  }

  // 10 Laboratories (2 per department, capacities >= 65 so any section fits cleanly)
  function buildLabs() {
    return [
      { id: 'LAB-01', name: 'High-Performance Computing Lab', department: 'CSE', labType: 'computing', capacity: 65, block: 'Block A', powerZone: 'PZ-1', requiresNetwork: true, status: 'operational' },
      { id: 'LAB-02', name: 'AI & Cloud Systems Lab (UPS Backup)', department: 'CSE', labType: 'computing', capacity: 65, block: 'Block A', powerZone: 'PZ-2', requiresNetwork: false, status: 'operational' },
      { id: 'LAB-03', name: 'VLSI & Embedded Systems Lab', department: 'ECE', labType: 'electronics', capacity: 65, block: 'Block B', powerZone: 'PZ-1', requiresNetwork: false, status: 'operational' },
      { id: 'LAB-04', name: 'RF & Digital Comm. Lab', department: 'ECE', labType: 'electronics', capacity: 65, block: 'Block B', powerZone: 'PZ-2', requiresNetwork: false, status: 'operational' },
      { id: 'LAB-05', name: 'Thermal & Fluid Mechanics Lab', department: 'ME', labType: 'mechanical', capacity: 65, block: 'Block C', powerZone: 'PZ-2', requiresNetwork: false, status: 'operational' },
      { id: 'LAB-06', name: 'CAD/CAM & Robotics Workshop', department: 'ME', labType: 'mechanical', capacity: 65, block: 'Block C', powerZone: 'PZ-2', requiresNetwork: true, status: 'operational' },
      { id: 'LAB-07', name: 'Concrete & Structural Testing Lab', department: 'CE', labType: 'civil', capacity: 65, block: 'Block D', powerZone: 'PZ-3', requiresNetwork: false, status: 'operational' },
      { id: 'LAB-08', name: 'Geomatics & GIS Lab', department: 'CE', labType: 'civil', capacity: 65, block: 'Block D', powerZone: 'PZ-3', requiresNetwork: true, status: 'operational' },
      { id: 'LAB-09', name: 'High Voltage & Machines Lab', department: 'EEE', labType: 'electrical', capacity: 65, block: 'Block E', powerZone: 'PZ-3', requiresNetwork: false, status: 'operational' },
      { id: 'LAB-10', name: 'Smart Grid & Drives Lab', department: 'EEE', labType: 'electrical', capacity: 65, block: 'Block E', powerZone: 'PZ-3', requiresNetwork: true, status: 'operational' }
    ];
  }

  // 8 Campus Buses
  function buildBuses(sections, faculty) {
    const routes = [
      'North Sector Express',
      'Metro Hub Shuttle',
      'East Tech Corridor',
      'Old City Terminal',
      'South Ring Road',
      'West Lakeview Route',
      'Central Rail Link',
      'Airport Highway Express'
    ];
    return routes.map((route, i) => {
      const id = `BUS-0${i + 1}`;
      const linkedSections = sections.filter((s) => s.busIds.includes(id)).map((s) => s.id);
      const linkedFaculty = faculty.filter((f) => f.busId === id).map((f) => f.id);
      const studentLoad = Math.round(
        sections.filter((s) => s.busIds.includes(id)).reduce((acc, s) => acc + s.busCommuters / 2, 0)
      );
      return {
        id,
        name: `Bus ${i + 1} — ${route}`,
        route,
        capacity: 75,
        studentLoad,
        linkedSections,
        linkedFaculty,
        status: 'operational'
      };
    });
  }

  // 4 Hostels
  function buildHostels(sections, faculty) {
    const specs = [
      { id: 'HST-01', name: 'Aryabhata Boys Hostel', capacity: 320, powerZone: 'PZ-3', wardenId: 'FAC-02' },
      { id: 'HST-02', name: 'Ramanujan Boys Hostel', capacity: 300, powerZone: 'PZ-3', wardenId: 'FAC-12' },
      { id: 'HST-03', name: 'Kalpana Chawla Girls Hostel', capacity: 280, powerZone: 'PZ-2', wardenId: 'FAC-22' },
      { id: 'HST-04', name: 'Sarojini Girls Hostel', capacity: 280, powerZone: 'PZ-2', wardenId: 'FAC-32' }
    ];
    return specs.map((h) => {
      const residentSections = sections.filter((s) => s.hostelId === h.id);
      const occupancy = residentSections.reduce((acc, s) => acc + s.hostelResidents, 0);
      const warden = faculty.find((f) => f.id === h.wardenId);
      return {
        ...h,
        occupancy,
        wardenName: warden ? warden.name : 'Assigned Warden',
        linkedSections: residentSections.map((s) => s.id),
        status: 'operational'
      };
    });
  }

  // 5 Administrative Resources
  function buildAdminResources() {
    return [
      { id: 'ADM-01', name: 'Placement & Career Cell', category: 'Governance', block: 'Placement Wing', critical: true, status: 'operational' },
      { id: 'ADM-02', name: 'Main Substation & Power Grid (PZ-1)', category: 'Power Infrastructure', block: 'Utility Block', critical: true, powerZone: 'PZ-1', status: 'operational' },
      { id: 'ADM-03', name: 'Controller of Examinations Office', category: 'Examinations', block: 'Exam Wing', critical: true, status: 'operational' },
      { id: 'ADM-04', name: 'Central Transport & Fleet Control', category: 'Logistics', block: 'Transport Yard', critical: true, status: 'operational' },
      { id: 'ADM-05', name: 'Campus Core Network & Data Center', category: 'IT Infrastructure', block: 'Block A', critical: true, powerZone: 'PZ-1', status: 'operational' }
    ];
  }

  /**
   * Generate a guaranteed 100% conflict-free Weekly Timetable:
   * - 20 sections x 6 weekly sessions each = 120 regular academic sessions (4 lectures + 2 labs per section)
   * - Plus 5 Scheduled Examinations, 3 Placement Drives, and 3 Institutional Events
   *   placed in verified free slots with zero section, faculty, or room collisions!
   */
  function buildTimetableAndActivities(faculty, sections, classrooms, labs, refWeek) {
    const timetable = [];
    // Track usage maps to guarantee zero conflict by construction
    const busyFaculty = new Set(); // `${facultyId}|${day}|${slotId}`
    const busySection = new Set(); // `${sectionId}|${day}|${slotId}`
    const busyRoom = new Set();    // `${roomId}|${day}|${slotId}`
    const facultyLoad = {};
    faculty.forEach((f) => { facultyLoad[f.id] = 0; });

    const timeGrid = [];
    for (let d = 0; d < DAYS.length; d++) {
      for (let s = 0; s < SLOTS.length; s++) {
        timeGrid.push({ day: DAYS[d], slotId: SLOTS[s].id, slotIndex: d * 5 + s });
      }
    }

    let sessionSeq = 1;

    // Assign 6 sessions (4 lectures + 2 labs) for each of the 20 sections
    sections.forEach((sec, secIdx) => {
      const deptSubjects = SUBJECTS.filter((sub) => sub.department === sec.department);
      // 4 lectures + 2 labs
      const plan = [
        deptSubjects[0], // lecture 1
        deptSubjects[1], // lecture 2
        deptSubjects[2], // lecture 3
        deptSubjects[0], // lecture 1 second class
        deptSubjects[3], // lab 1
        deptSubjects[4]  // lab 2
      ];

      // Preferred department classrooms & labs
      const deptRooms = classrooms.filter((r) => r.department === sec.department && r.capacity >= sec.studentCount);
      const centralLectureFallback = classrooms.filter((r) => r.type === 'lecture' && r.capacity >= sec.studentCount);
      const candidateRooms = [...deptRooms, ...centralLectureFallback];
      const deptLabs = labs.filter((l) => l.department === sec.department && l.capacity >= sec.studentCount);

      plan.forEach((sub, itemIdx) => {
        // Rotate starting day/slot by section index so campus utilization spreads evenly across all 25 slots
        const startOffset = (secIdx * 3 + itemIdx * 4) % timeGrid.length;
        let placed = false;

        for (let step = 0; step < timeGrid.length; step++) {
          const { day, slotId } = timeGrid[(startOffset + step) % timeGrid.length];
          if (busySection.has(`${sec.id}|${day}|${slotId}`)) continue;

          // Pick qualified faculty in the same department with available load & free slot
          // Keep at least 2 hrs headroom on most faculty so substitutions are realistic
          const eligibleFac = faculty
            .filter((f) =>
              f.department === sec.department &&
              f.qualifications.includes(sub.id) &&
              !busyFaculty.has(`${f.id}|${day}|${slotId}`) &&
              facultyLoad[f.id] + 1 <= f.maxWeeklyLoad - 2
            )
            .sort((a, b) => facultyLoad[a.id] - facultyLoad[b.id]);

          if (eligibleFac.length === 0) continue;

          let chosenRoom = null;
          if (sub.type === 'lab') {
            chosenRoom = deptLabs.find(
              (l) => l.labType === sub.labType && !busyRoom.has(`${l.id}|${day}|${slotId}`)
            );
          } else {
            chosenRoom = candidateRooms.find((r) => !busyRoom.has(`${r.id}|${day}|${slotId}`));
          }

          if (!chosenRoom) continue;

          const chosenFac = eligibleFac[0];
          busyFaculty.add(`${chosenFac.id}|${day}|${slotId}`);
          busySection.add(`${sec.id}|${day}|${slotId}`);
          busyRoom.add(`${chosenRoom.id}|${day}|${slotId}`);
          facultyLoad[chosenFac.id] += 1;

          timetable.push({
            id: `TT-${String(sessionSeq++).padStart(3, '0')}`,
            day,
            slotId,
            department: sec.department,
            sectionId: sec.id,
            subjectId: sub.id,
            subjectCode: sub.code,
            subjectName: sub.name,
            facultyId: chosenFac.id,
            roomId: chosenRoom.id,
            roomType: sub.type === 'lab' ? 'lab' : 'classroom',
            labType: sub.labType,
            activityType: sub.type === 'lab' ? 'LAB' : 'LECTURE',
            priority: sub.type === 'lab' ? 60 : 40,
            studentCount: sec.studentCount,
            status: 'operational'
          });
          placed = true;
          break;
        }

        if (!placed) {
          throw new Error(`Failed to place ${sub.id} for ${sec.id}`);
        }
      });
    });

    // Helper to find a completely conflict-free slot for special institutional activities
    function placeSpecialActivity(sectionId, roomCandidates, facCandidates, preferredDays) {
      for (const day of preferredDays) {
        for (const slot of SLOTS) {
          if (busySection.has(`${sectionId}|${day}|${slot.id}`)) continue;
          const room = roomCandidates.find((r) => !busyRoom.has(`${r.id}|${day}|${slot.id}`));
          if (!room) continue;
          const fac = facCandidates.find(
            (f) => !busyFaculty.has(`${f.id}|${day}|${slot.id}`) && facultyLoad[f.id] + 1 <= f.maxWeeklyLoad
          );
          if (!fac) continue;
          busySection.add(`${sectionId}|${day}|${slot.id}`);
          busyRoom.add(`${room.id}|${day}|${slot.id}`);
          busyFaculty.add(`${fac.id}|${day}|${slot.id}`);
          facultyLoad[fac.id] += 1;
          return { day, slotId: slot.id, roomId: room.id, facultyId: fac.id };
        }
      }
      return null;
    }

    // 5 Examinations (one per department's senior section, placed in Exam Halls CR-21..CR-23)
    const examSpecs = [
      { id: 'EXM-01', title: 'CSE Mid-Sem Exam: Algorithms & OS', sectionId: 'SEC-CSE-4', department: 'CSE', preferredRoom: 'CR-21', preferredDays: ['Wed', 'Thu', 'Fri'] },
      { id: 'EXM-02', title: 'ECE Mid-Sem Exam: VLSI Systems', sectionId: 'SEC-ECE-4', department: 'ECE', preferredRoom: 'CR-22', preferredDays: ['Wed', 'Thu', 'Fri'] },
      { id: 'EXM-03', title: 'ME Mid-Sem Exam: Thermodynamics', sectionId: 'SEC-ME-4', department: 'ME', preferredRoom: 'CR-21', preferredDays: ['Thu', 'Fri', 'Tue'] },
      { id: 'EXM-04', title: 'CE Mid-Sem Exam: Structural Design', sectionId: 'SEC-CE-4', department: 'CE', preferredRoom: 'CR-23', preferredDays: ['Thu', 'Fri', 'Wed'] },
      { id: 'EXM-05', title: 'EEE Mid-Sem Exam: Power Systems', sectionId: 'SEC-EEE-4', department: 'EEE', preferredRoom: 'CR-22', preferredDays: ['Fri', 'Tue', 'Wed'] }
    ];

    const examinations = examSpecs.map((spec) => {
      const sec = sections.find((s) => s.id === spec.sectionId);
      const examRooms = classrooms
        .filter((r) => (r.id === spec.preferredRoom || r.type === 'exam-hall') && r.capacity >= sec.studentCount)
        .sort((a, b) => (a.id === spec.preferredRoom ? -1 : 1));
      const deptFac = faculty.filter((f) => f.department === spec.department);
      const placed = placeSpecialActivity(spec.sectionId, examRooms, deptFac, spec.preferredDays);
      if (!placed) throw new Error(`Failed to schedule ${spec.id}`);
      return {
        id: spec.id,
        title: spec.title,
        department: spec.department,
        sectionId: spec.sectionId,
        studentCount: sec.studentCount,
        day: placed.day,
        scheduledDate: refWeek[placed.day],
        slotId: placed.slotId,
        roomId: placed.roomId,
        invigilatorId: placed.facultyId,
        adminId: 'ADM-03',
        activityType: 'EXAM',
        priority: 100,
        status: 'operational'
      };
    });

    // 3 Placement Drives (Sem 7 sections in Auditorium CR-24/CR-25)
    const placementSpecs = [
      { id: 'PLC-01', company: 'TechNova Cloud Systems', role: 'SDE-1 Campus Drive', sectionId: 'SEC-CSE-4', department: 'CSE', preferredRoom: 'CR-24', preferredDays: ['Tue', 'Wed', 'Fri'] },
      { id: 'PLC-02', company: 'SiliconCore Semiconductors', role: 'VLSI Design Trainee', sectionId: 'SEC-ECE-4', department: 'ECE', preferredRoom: 'CR-25', preferredDays: ['Tue', 'Thu', 'Fri'] },
      { id: 'PLC-03', company: 'Apex Infra & Grid Corp', role: 'Graduate Engineer Drive', sectionId: 'SEC-ME-4', department: 'ME', preferredRoom: 'CR-24', preferredDays: ['Wed', 'Thu', 'Fri'] }
    ];

    const placements = placementSpecs.map((spec) => {
      const sec = sections.find((s) => s.id === spec.sectionId);
      const audRooms = classrooms
        .filter((r) => r.type === 'auditorium' && r.capacity >= sec.studentCount)
        .sort((a, b) => (a.id === spec.preferredRoom ? -1 : 1));
      const deptFac = faculty.filter((f) => f.department === spec.department);
      const placed = placeSpecialActivity(spec.sectionId, audRooms, deptFac, spec.preferredDays);
      if (!placed) throw new Error(`Failed to schedule ${spec.id}`);
      return {
        id: spec.id,
        company: spec.company,
        title: `${spec.company} — ${spec.role}`,
        department: spec.department,
        sectionId: spec.sectionId,
        studentCount: sec.studentCount,
        day: placed.day,
        scheduledDate: refWeek[placed.day],
        slotId: placed.slotId,
        roomId: placed.roomId,
        coordinatorId: placed.facultyId,
        adminId: 'ADM-01',
        activityType: 'PLACEMENT',
        priority: 80,
        status: 'operational'
      };
    });

    // 3 Institutional Events
    const eventSpecs = [
      { id: 'EVT-01', title: 'National AI & Systems Symposium', sectionId: 'SEC-CSE-3', department: 'CSE', preferredRoom: 'CR-25', preferredDays: ['Mon', 'Thu', 'Fri'] },
      { id: 'EVT-02', title: 'Autonomous Robotics Workshop', sectionId: 'SEC-ME-3', department: 'ME', preferredRoom: 'CR-25', preferredDays: ['Mon', 'Tue', 'Fri'] },
      { id: 'EVT-03', title: 'Smart Grid Innovation Colloquium', sectionId: 'SEC-EEE-3', department: 'EEE', preferredRoom: 'CR-24', preferredDays: ['Mon', 'Tue', 'Thu'] }
    ];

    const events = eventSpecs.map((spec) => {
      const sec = sections.find((s) => s.id === spec.sectionId);
      const audRooms = classrooms
        .filter((r) => (r.type === 'auditorium' || r.capacity >= 70) && r.capacity >= sec.studentCount)
        .sort((a, b) => (a.id === spec.preferredRoom ? -1 : 1));
      const deptFac = faculty.filter((f) => f.department === spec.department);
      const placed = placeSpecialActivity(spec.sectionId, audRooms, deptFac, spec.preferredDays);
      if (!placed) throw new Error(`Failed to schedule ${spec.id}`);
      return {
        id: spec.id,
        title: spec.title,
        department: spec.department,
        sectionId: spec.sectionId,
        studentCount: sec.studentCount,
        day: placed.day,
        scheduledDate: refWeek[placed.day],
        slotId: placed.slotId,
        roomId: placed.roomId,
        coordinatorId: placed.facultyId,
        activityType: 'EVENT',
        priority: 20,
        status: 'operational'
      };
    });

    return { timetable, examinations, placements, events };
  }

  /**
   * Build the 8 Predefined Disruption Scenarios dynamically referencing real campus entities
   * Each scenario includes structured defaultConfigs used by the Dynamic Failure Builder.
   */
  function buildScenarios(data, refWeek) {
    const allWeekDates = DAYS.map((d) => refWeek[d]);
    const fac01 = data.faculty[0];
    const fac01Sessions = data.timetable.filter((t) => t.facultyId === fac01.id);
    const morningBusFac = data.faculty.find((f) => f.busId === 'BUS-01') || data.faculty[0];
    const exam1 = data.examinations[0];
    const exam1Slot = SLOTS.find((s) => s.id === exam1.slotId) || SLOTS[0];
    const plc1 = data.placements[0];
    const lab1 = data.labs[0];
    const room1 = data.classrooms[0];

    return [
      {
        id: 'SCN-FACULTY-ABSENCE',
        name: 'Faculty Absence',
        badge: 'HR / Teaching',
        description: `Sudden medical absence of ${fac01.name} (${fac01.id}, ${fac01.department}, ${fac01Sessions.length} weekly sessions).`,
        targets: [fac01.id],
        conflictInjections: [],
        defaultConfigs: [
          {
            scenarioType: 'SCN-FACULTY-ABSENCE',
            department: fac01.department,
            scheduleMode: 'shared',
            facultyCount: 1,
            facultyIds: [fac01.id],
            facultyId: fac01.id,
            reason: 'Medical Leave',
            dates: [...allWeekDates],
            fullDay: true,
            perDateTimes: false,
            timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
            dateTimePeriods: {}
          }
        ]
      },
      {
        id: 'SCN-LAB-FAILURE',
        name: 'Laboratory Failure',
        badge: 'Equipment',
        description: `Cooling & server cluster fault in ${lab1.name} (${lab1.id}) rendering 100% equipment unavailable.`,
        targets: [lab1.id],
        conflictInjections: [],
        defaultConfigs: [
          {
            scenarioType: 'SCN-LAB-FAILURE',
            department: lab1.department,
            labIds: [lab1.id],
            labId: lab1.id,
            failureType: 'cooling',
            equipmentUnavailablePct: 100,
            dates: [...allWeekDates],
            fullDay: true,
            perDateTimes: false,
            timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
            dateTimePeriods: {}
          }
        ]
      },
      {
        id: 'SCN-CLASSROOM-UNAVAILABLE',
        name: 'Classroom Unavailability',
        badge: 'Facilities',
        description: `${room1.name} (${room1.id}, ${room1.block}) closed for emergency HVAC & ceiling repair.`,
        targets: [room1.id],
        conflictInjections: [],
        defaultConfigs: [
          {
            scenarioType: 'SCN-CLASSROOM-UNAVAILABLE',
            building: room1.block,
            classroomIds: [room1.id],
            classroomId: room1.id,
            reason: 'HVAC Failure',
            dates: [...allWeekDates],
            fullDay: true,
            perDateTimes: false,
            timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
            dateTimePeriods: {}
          }
        ]
      },
      {
        id: 'SCN-BUS-BREAKDOWN',
        name: 'Bus Breakdown',
        badge: 'Transit',
        description: `Morning breakdown on BUS-01 delaying ${morningBusFac.name} and linked commuting faculty/students for 2 hours (09:00–11:00).`,
        targets: ['BUS-01'],
        conflictInjections: [],
        defaultConfigs: [
          {
            scenarioType: 'SCN-BUS-BREAKDOWN',
            busIds: ['BUS-01'],
            busId: 'BUS-01',
            breakdownType: 'Engine Fault',
            dates: [...allWeekDates],
            date: refWeek.Mon,
            startTime: '09:00',
            restorationTime: '11:00',
            spareBusAvailable: false
          }
        ]
      },
      {
        id: 'SCN-EXAM-HALL-FAILURE',
        name: 'Examination Hall Failure',
        badge: 'Critical Exam',
        description: `Main Exam Hall Alpha (${exam1.roomId}) power & seating failure affecting ${exam1.title} (${formatDateDMY(exam1.scheduledDate)}).`,
        targets: [exam1.roomId],
        conflictInjections: [],
        defaultConfigs: [
          {
            scenarioType: 'SCN-EXAM-HALL-FAILURE',
            roomId: exam1.roomId,
            examId: exam1.id,
            reason: 'Power & Lighting Outage',
            availableSeating: 0,
            capacityUnavailablePct: 100,
            dates: [exam1.scheduledDate],
            fullDay: true,
            perDateTimes: false,
            timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
            dateTimePeriods: {}
          }
        ]
      },
      {
        id: 'SCN-POWER-FAILURE',
        name: 'Campus Power Failure',
        badge: 'Grid Outage',
        description: 'Main Substation (ADM-02) outage cutting Power Zone PZ-1 (Block A, Block B, Exam Hall Alpha, Turing Auditorium & Core Network).',
        targets: ['ADM-02'],
        conflictInjections: [],
        defaultConfigs: [
          {
            scenarioType: 'SCN-POWER-FAILURE',
            powerZone: 'PZ-1',
            failureSource: 'Main Substation (ADM-02)',
            dates: [...allWeekDates],
            fullDay: true,
            startTime: OPERATING_HOURS.startTime,
            endTime: OPERATING_HOURS.endTime,
            backupAvailable: false,
            backupCapacityPct: 0
          }
        ]
      },
      {
        id: 'SCN-PLACEMENT-EXAM-CONFLICT',
        name: 'Placement & Exam Conflict',
        badge: 'Schedule Clash',
        description: `Emergency rescheduling forces ${plc1.company} (${plc1.id}) into ${formatDateDMY(exam1.scheduledDate)} (${exam1.day} ${exam1.slotId}) alongside ${exam1.id} for ${exam1.sectionId}.`,
        targets: [],
        conflictInjections: [
          {
            type: 'PLACEMENT_EXAM_CLASH',
            placementId: plc1.id,
            examId: exam1.id,
            day: exam1.day,
            slotId: exam1.slotId,
            roomId: exam1.roomId
          }
        ],
        defaultConfigs: [
          {
            scenarioType: 'SCN-PLACEMENT-EXAM-CONFLICT',
            placementId: plc1.id,
            examId: exam1.id,
            proposedDate: exam1.scheduledDate,
            proposedStartTime: exam1Slot.startTime,
            proposedEndTime: exam1Slot.endTime,
            conflictDay: exam1.day,
            conflictSlotId: exam1.slotId,
            reschedulingPriority: 'EXAM_FIRST'
          }
        ]
      },
      {
        id: 'SCN-MULTI-DISRUPTION',
        name: 'Multiple Simultaneous Disruptions',
        badge: 'Compound Crisis',
        description: 'Compound campus crisis: FAC-01 absent + LAB-01 cooling failure + BUS-02 breakdown + Exam Hall Alpha (CR-21) failure.',
        targets: ['FAC-01', 'LAB-01', 'BUS-02', 'CR-21'],
        conflictInjections: [],
        defaultConfigs: [
          {
            scenarioType: 'SCN-FACULTY-ABSENCE',
            department: fac01.department,
            scheduleMode: 'shared',
            facultyCount: 1,
            facultyIds: [fac01.id],
            facultyId: fac01.id,
            reason: 'Medical Leave',
            dates: [...allWeekDates],
            fullDay: true,
            perDateTimes: false,
            timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
            dateTimePeriods: {}
          },
          {
            scenarioType: 'SCN-LAB-FAILURE',
            department: lab1.department,
            labIds: [lab1.id],
            labId: lab1.id,
            failureType: 'cooling',
            equipmentUnavailablePct: 100,
            dates: [...allWeekDates],
            fullDay: true,
            perDateTimes: false,
            timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
            dateTimePeriods: {}
          },
          {
            scenarioType: 'SCN-BUS-BREAKDOWN',
            busIds: ['BUS-02'],
            busId: 'BUS-02',
            breakdownType: 'Traffic / Route Blockage',
            dates: [...allWeekDates],
            date: refWeek.Mon,
            startTime: '09:00',
            restorationTime: '11:00',
            spareBusAvailable: false
          },
          {
            scenarioType: 'SCN-EXAM-HALL-FAILURE',
            roomId: exam1.roomId,
            examId: exam1.id,
            reason: 'Power & Lighting Outage',
            availableSeating: 0,
            capacityUnavailablePct: 100,
            dates: [exam1.scheduledDate],
            fullDay: true,
            perDateTimes: false,
            timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
            dateTimePeriods: {}
          }
        ]
      }
    ];
  }

  function createInitialCampusState(anchorDate = new Date()) {
    const refWeek = getSimulationReferenceWeek(anchorDate);
    const faculty = buildFaculty();
    const sections = buildSections();
    const classrooms = buildClassrooms();
    const labs = buildLabs();
    const buses = buildBuses(sections, faculty);
    const hostels = buildHostels(sections, faculty);
    const admin = buildAdminResources();
    const { timetable, examinations, placements, events } = buildTimetableAndActivities(
      faculty,
      sections,
      classrooms,
      labs,
      refWeek
    );

    const state = {
      meta: {
        institutionName: 'OMNIS-X Institute of Engineering & Technology',
        totalStudents: sections.reduce((sum, s) => sum + s.studentCount, 0),
        days: DAYS,
        slots: SLOTS,
        operatingHours: OPERATING_HOURS,
        referenceWeek: refWeek
      },
      departments: DEPARTMENTS,
      subjects: SUBJECTS,
      faculty,
      sections,
      classrooms,
      labs,
      buses,
      hostels,
      admin,
      timetable,
      examinations,
      placements,
      events,
      activeFailures: [],
      conflictInjections: []
    };

    state.scenarios = buildScenarios(state, refWeek);
    return state;
  }

  global.OMNIS_DATA = {
    DAYS,
    WEEKDAY_NAMES,
    SLOTS,
    OPERATING_HOURS,
    toISODate,
    parseISODate,
    formatDateDMY,
    getWeekdayName,
    getSimulationReferenceWeek,
    createInitialCampusState
  };
})(window);
