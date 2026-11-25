-- ============================================================================
-- OMNIS-X — Optional Reference Seed Script (from data.js)
-- Run AFTER supabase/schema.sql in Supabase SQL Editor
-- ============================================================================

-- 1. Faculty (50)
insert into public.ref_faculty (id, name, department, designation, qualifications, max_weekly_load, bus_id, is_hostel_warden) values
  ('FAC-01', 'Dr. Arvind Menon', 'CSE', 'Professor & HOD', '["SUB-CSE-1", "SUB-CSE-2", "SUB-CSE-4", "SUB-CSE-3", "SUB-CSE-5"]'::jsonb, 12, 'BUS-01', null),
  ('FAC-02', 'Dr. Kavita Nair', 'CSE', 'Professor', '["SUB-CSE-2", "SUB-CSE-3", "SUB-CSE-5", "SUB-CSE-1", "SUB-CSE-4"]'::jsonb, 12, null, 'HST-01'),
  ('FAC-03', 'Prof. Rohan Kulkarni', 'CSE', 'Associate Professor', '["SUB-CSE-3", "SUB-CSE-1", "SUB-CSE-4", "SUB-CSE-2", "SUB-CSE-5"]'::jsonb, 14, 'BUS-01', null),
  ('FAC-04', 'Dr. Sneha Iyer', 'CSE', 'Associate Professor', '["SUB-CSE-1", "SUB-CSE-2", "SUB-CSE-5", "SUB-CSE-3", "SUB-CSE-4"]'::jsonb, 14, null, null),
  ('FAC-05', 'Prof. Vikramaditya Rao', 'CSE', 'Assistant Professor', '["SUB-CSE-2", "SUB-CSE-3", "SUB-CSE-4", "SUB-CSE-5"]'::jsonb, 14, null, null),
  ('FAC-06', 'Dr. Meera Deshmukh', 'CSE', 'Associate Professor', '["SUB-CSE-3", "SUB-CSE-1", "SUB-CSE-5"]'::jsonb, 16, null, null),
  ('FAC-07', 'Prof. Siddharth Joshi', 'CSE', 'Assistant Professor', '["SUB-CSE-1", "SUB-CSE-2", "SUB-CSE-4", "SUB-CSE-5"]'::jsonb, 16, 'BUS-02', null),
  ('FAC-08', 'Dr. Ananya Chatterjee', 'CSE', 'Assistant Professor', '["SUB-CSE-2", "SUB-CSE-3", "SUB-CSE-5"]'::jsonb, 16, null, null),
  ('FAC-09', 'Prof. Karthik Subramanian', 'CSE', 'Assistant Professor', '["SUB-CSE-3", "SUB-CSE-1", "SUB-CSE-4", "SUB-CSE-5"]'::jsonb, 16, null, null),
  ('FAC-10', 'Dr. Neha Kapoor', 'CSE', 'Assistant Professor', '["SUB-CSE-1", "SUB-CSE-2", "SUB-CSE-5"]'::jsonb, 16, 'BUS-03', null),
  ('FAC-11', 'Dr. Rajeshwar Pillai', 'ECE', 'Professor & HOD', '["SUB-ECE-1", "SUB-ECE-2", "SUB-ECE-4", "SUB-ECE-3", "SUB-ECE-5"]'::jsonb, 12, null, null),
  ('FAC-12', 'Dr. Pooja Venkatesh', 'ECE', 'Professor', '["SUB-ECE-2", "SUB-ECE-3", "SUB-ECE-5", "SUB-ECE-1", "SUB-ECE-4"]'::jsonb, 12, 'BUS-02', 'HST-02'),
  ('FAC-13', 'Prof. Aditya Malhotra', 'ECE', 'Associate Professor', '["SUB-ECE-3", "SUB-ECE-1", "SUB-ECE-4", "SUB-ECE-2", "SUB-ECE-5"]'::jsonb, 14, null, null),
  ('FAC-14', 'Dr. Divya Krishnan', 'ECE', 'Associate Professor', '["SUB-ECE-1", "SUB-ECE-2", "SUB-ECE-5", "SUB-ECE-3", "SUB-ECE-4"]'::jsonb, 14, null, null),
  ('FAC-15', 'Prof. Harshvardhan Sen', 'ECE', 'Assistant Professor', '["SUB-ECE-2", "SUB-ECE-3", "SUB-ECE-4", "SUB-ECE-5"]'::jsonb, 14, 'BUS-04', null),
  ('FAC-16', 'Dr. Nandini Bhat', 'ECE', 'Associate Professor', '["SUB-ECE-3", "SUB-ECE-1", "SUB-ECE-5"]'::jsonb, 16, null, null),
  ('FAC-17', 'Prof. Pranav Gokhale', 'ECE', 'Assistant Professor', '["SUB-ECE-1", "SUB-ECE-2", "SUB-ECE-4", "SUB-ECE-5"]'::jsonb, 16, null, null),
  ('FAC-18', 'Dr. Shreya Banerjee', 'ECE', 'Assistant Professor', '["SUB-ECE-2", "SUB-ECE-3", "SUB-ECE-5"]'::jsonb, 16, 'BUS-05', null),
  ('FAC-19', 'Prof. Manish Tiwari', 'ECE', 'Assistant Professor', '["SUB-ECE-3", "SUB-ECE-1", "SUB-ECE-4", "SUB-ECE-5"]'::jsonb, 16, null, null),
  ('FAC-20', 'Dr. Swati Agrawal', 'ECE', 'Assistant Professor', '["SUB-ECE-1", "SUB-ECE-2", "SUB-ECE-5"]'::jsonb, 16, 'BUS-01', null),
  ('FAC-21', 'Dr. Suresh Babu', 'ME', 'Professor & HOD', '["SUB-ME-1", "SUB-ME-2", "SUB-ME-4", "SUB-ME-3", "SUB-ME-5"]'::jsonb, 12, null, null),
  ('FAC-22', 'Dr. Rekha Choudhary', 'ME', 'Professor', '["SUB-ME-2", "SUB-ME-3", "SUB-ME-5", "SUB-ME-1", "SUB-ME-4"]'::jsonb, 12, null, 'HST-03'),
  ('FAC-23', 'Prof. Nikhil Verma', 'ME', 'Associate Professor', '["SUB-ME-3", "SUB-ME-1", "SUB-ME-4", "SUB-ME-2", "SUB-ME-5"]'::jsonb, 14, 'BUS-03', null),
  ('FAC-24', 'Dr. Gayatri Kulkarni', 'ME', 'Associate Professor', '["SUB-ME-1", "SUB-ME-2", "SUB-ME-5", "SUB-ME-3", "SUB-ME-4"]'::jsonb, 14, null, null),
  ('FAC-25', 'Prof. Deepak Chauhan', 'ME', 'Assistant Professor', '["SUB-ME-2", "SUB-ME-3", "SUB-ME-4", "SUB-ME-5"]'::jsonb, 14, 'BUS-06', null),
  ('FAC-26', 'Dr. Pallavi Deshpande', 'ME', 'Associate Professor', '["SUB-ME-3", "SUB-ME-1", "SUB-ME-5"]'::jsonb, 16, null, null),
  ('FAC-27', 'Prof. Varun Saxena', 'ME', 'Assistant Professor', '["SUB-ME-1", "SUB-ME-2", "SUB-ME-4", "SUB-ME-5"]'::jsonb, 16, null, null),
  ('FAC-28', 'Dr. Ashwini Patil', 'ME', 'Assistant Professor', '["SUB-ME-2", "SUB-ME-3", "SUB-ME-5"]'::jsonb, 16, 'BUS-04', null),
  ('FAC-29', 'Prof. Tarun Mehta', 'ME', 'Assistant Professor', '["SUB-ME-3", "SUB-ME-1", "SUB-ME-4", "SUB-ME-5"]'::jsonb, 16, null, null),
  ('FAC-30', 'Dr. Sunita Reddy', 'ME', 'Assistant Professor', '["SUB-ME-1", "SUB-ME-2", "SUB-ME-5"]'::jsonb, 16, 'BUS-07', null),
  ('FAC-31', 'Dr. Mahendra Hegde', 'CE', 'Professor & HOD', '["SUB-CE-1", "SUB-CE-2", "SUB-CE-4", "SUB-CE-3", "SUB-CE-5"]'::jsonb, 12, null, null),
  ('FAC-32', 'Dr. Vandana Mishra', 'CE', 'Professor', '["SUB-CE-2", "SUB-CE-3", "SUB-CE-5", "SUB-CE-1", "SUB-CE-4"]'::jsonb, 12, null, 'HST-04'),
  ('FAC-33', 'Prof. Abhishek Sharma', 'CE', 'Associate Professor', '["SUB-CE-3", "SUB-CE-1", "SUB-CE-4", "SUB-CE-2", "SUB-CE-5"]'::jsonb, 14, 'BUS-05', null),
  ('FAC-34', 'Dr. Bhavna Joshi', 'CE', 'Associate Professor', '["SUB-CE-1", "SUB-CE-2", "SUB-CE-5", "SUB-CE-3", "SUB-CE-4"]'::jsonb, 14, null, null),
  ('FAC-35', 'Prof. Gaurav Tripathi', 'CE', 'Assistant Professor', '["SUB-CE-2", "SUB-CE-3", "SUB-CE-4", "SUB-CE-5"]'::jsonb, 14, 'BUS-08', null),
  ('FAC-36', 'Dr. Kritika Bose', 'CE', 'Associate Professor', '["SUB-CE-3", "SUB-CE-1", "SUB-CE-5"]'::jsonb, 16, null, null),
  ('FAC-37', 'Prof. Sandeep Yadav', 'CE', 'Assistant Professor', '["SUB-CE-1", "SUB-CE-2", "SUB-CE-4", "SUB-CE-5"]'::jsonb, 16, 'BUS-06', null),
  ('FAC-38', 'Dr. Ritika Nambiar', 'CE', 'Assistant Professor', '["SUB-CE-2", "SUB-CE-3", "SUB-CE-5"]'::jsonb, 16, null, null),
  ('FAC-39', 'Prof. Vivek Ranjan', 'CE', 'Assistant Professor', '["SUB-CE-3", "SUB-CE-1", "SUB-CE-4", "SUB-CE-5"]'::jsonb, 16, 'BUS-02', null),
  ('FAC-40', 'Dr. Shalini Gupta', 'CE', 'Assistant Professor', '["SUB-CE-1", "SUB-CE-2", "SUB-CE-5"]'::jsonb, 16, null, null),
  ('FAC-41', 'Dr. Krishnanunni V.', 'EEE', 'Professor & HOD', '["SUB-EEE-1", "SUB-EEE-2", "SUB-EEE-4", "SUB-EEE-3", "SUB-EEE-5"]'::jsonb, 12, null, null),
  ('FAC-42', 'Dr. Madhuri Gokhale', 'EEE', 'Professor', '["SUB-EEE-2", "SUB-EEE-3", "SUB-EEE-5", "SUB-EEE-1", "SUB-EEE-4"]'::jsonb, 12, null, null),
  ('FAC-43', 'Prof. Saurabh Jain', 'EEE', 'Associate Professor', '["SUB-EEE-3", "SUB-EEE-1", "SUB-EEE-4", "SUB-EEE-2", "SUB-EEE-5"]'::jsonb, 14, 'BUS-07', null),
  ('FAC-44', 'Dr. Priyanka Das', 'EEE', 'Associate Professor', '["SUB-EEE-1", "SUB-EEE-2", "SUB-EEE-5", "SUB-EEE-3", "SUB-EEE-4"]'::jsonb, 14, null, null),
  ('FAC-45', 'Prof. Ankur Srivastava', 'EEE', 'Assistant Professor', '["SUB-EEE-2", "SUB-EEE-3", "SUB-EEE-4", "SUB-EEE-5"]'::jsonb, 14, 'BUS-08', null),
  ('FAC-46', 'Dr. Lavanya Prasad', 'EEE', 'Associate Professor', '["SUB-EEE-3", "SUB-EEE-1", "SUB-EEE-5"]'::jsonb, 16, null, null),
  ('FAC-47', 'Prof. Devendra Singh', 'EEE', 'Assistant Professor', '["SUB-EEE-1", "SUB-EEE-2", "SUB-EEE-4", "SUB-EEE-5"]'::jsonb, 16, 'BUS-03', null),
  ('FAC-48', 'Dr. Tanvi Phadke', 'EEE', 'Assistant Professor', '["SUB-EEE-2", "SUB-EEE-3", "SUB-EEE-5"]'::jsonb, 16, null, null),
  ('FAC-49', 'Prof. Rakesh Nair', 'EEE', 'Assistant Professor', '["SUB-EEE-3", "SUB-EEE-1", "SUB-EEE-4", "SUB-EEE-5"]'::jsonb, 16, 'BUS-04', null),
  ('FAC-50', 'Dr. Aparna Krishnan', 'EEE', 'Assistant Professor', '["SUB-EEE-1", "SUB-EEE-2", "SUB-EEE-5"]'::jsonb, 16, null, null)
on conflict (id) do update set name = excluded.name, department = excluded.department, designation = excluded.designation, qualifications = excluded.qualifications, max_weekly_load = excluded.max_weekly_load, bus_id = excluded.bus_id, is_hostel_warden = excluded.is_hostel_warden;

-- 2. Classrooms & Exam Halls (25)
insert into public.ref_classrooms (id, name, block, department, capacity, room_type, has_projector, power_zone) values
  ('CR-01', 'Block A LH-101', 'Block A', 'CSE', 65, 'lecture', true, 'PZ-1'),
  ('CR-02', 'Block A LH-102', 'Block A', 'CSE', 65, 'lecture', true, 'PZ-1'),
  ('CR-03', 'Block A LH-103', 'Block A', 'CSE', 70, 'lecture', true, 'PZ-1'),
  ('CR-04', 'Block A LH-104', 'Block A', 'CSE', 80, 'lecture', true, 'PZ-1'),
  ('CR-05', 'Block B LH-201', 'Block B', 'ECE', 65, 'lecture', true, 'PZ-1'),
  ('CR-06', 'Block B LH-202', 'Block B', 'ECE', 65, 'lecture', true, 'PZ-1'),
  ('CR-07', 'Block B LH-203', 'Block B', 'ECE', 70, 'lecture', true, 'PZ-1'),
  ('CR-08', 'Block B LH-204', 'Block B', 'ECE', 80, 'lecture', true, 'PZ-1'),
  ('CR-09', 'Block C LH-301', 'Block C', 'ME', 65, 'lecture', true, 'PZ-2'),
  ('CR-10', 'Block C LH-302', 'Block C', 'ME', 65, 'lecture', true, 'PZ-2'),
  ('CR-11', 'Block C LH-303', 'Block C', 'ME', 70, 'lecture', true, 'PZ-2'),
  ('CR-12', 'Block C LH-304', 'Block C', 'ME', 80, 'lecture', true, 'PZ-2'),
  ('CR-13', 'Block D LH-401', 'Block D', 'CE', 65, 'lecture', true, 'PZ-2'),
  ('CR-14', 'Block D LH-402', 'Block D', 'CE', 65, 'lecture', true, 'PZ-2'),
  ('CR-15', 'Block D LH-403', 'Block D', 'CE', 70, 'lecture', true, 'PZ-2'),
  ('CR-16', 'Block D LH-404', 'Block D', 'CE', 80, 'lecture', true, 'PZ-2'),
  ('CR-17', 'Block E LH-501', 'Block E', 'EEE', 65, 'lecture', true, 'PZ-3'),
  ('CR-18', 'Block E LH-502', 'Block E', 'EEE', 65, 'lecture', true, 'PZ-3'),
  ('CR-19', 'Block E LH-503', 'Block E', 'EEE', 70, 'lecture', true, 'PZ-3'),
  ('CR-20', 'Block E LH-504', 'Block E', 'EEE', 80, 'lecture', true, 'PZ-3'),
  ('CR-21', 'Exam Hall Alpha', 'Exam Wing', 'CENTRAL', 80, 'exam-hall', true, 'PZ-1'),
  ('CR-22', 'Exam Hall Beta', 'Exam Wing', 'CENTRAL', 80, 'exam-hall', true, 'PZ-2'),
  ('CR-23', 'Exam Hall Gamma', 'Exam Wing', 'CENTRAL', 70, 'exam-hall', true, 'PZ-2'),
  ('CR-24', 'Turing Auditorium', 'Placement Wing', 'CENTRAL', 140, 'auditorium', true, 'PZ-1'),
  ('CR-25', 'Visvesvaraya Seminar Hall', 'Placement Wing', 'CENTRAL', 120, 'auditorium', true, 'PZ-3')
on conflict (id) do update set name = excluded.name, block = excluded.block, department = excluded.department, capacity = excluded.capacity, room_type = excluded.room_type, has_projector = excluded.has_projector, power_zone = excluded.power_zone;

-- 3. Laboratories (10)
insert into public.ref_labs (id, name, department, lab_type, capacity, block, power_zone, requires_network) values
  ('LAB-01', 'High-Performance Computing Lab', 'CSE', 'computing', 65, 'Block A', 'PZ-1', true),
  ('LAB-02', 'AI & Cloud Systems Lab (UPS Backup)', 'CSE', 'computing', 65, 'Block A', 'PZ-2', false),
  ('LAB-03', 'VLSI & Embedded Systems Lab', 'ECE', 'electronics', 65, 'Block B', 'PZ-1', false),
  ('LAB-04', 'RF & Digital Comm. Lab', 'ECE', 'electronics', 65, 'Block B', 'PZ-2', false),
  ('LAB-05', 'Thermal & Fluid Mechanics Lab', 'ME', 'mechanical', 65, 'Block C', 'PZ-2', false),
  ('LAB-06', 'CAD/CAM & Robotics Workshop', 'ME', 'mechanical', 65, 'Block C', 'PZ-2', true),
  ('LAB-07', 'Concrete & Structural Testing Lab', 'CE', 'civil', 65, 'Block D', 'PZ-3', false),
  ('LAB-08', 'Geomatics & GIS Lab', 'CE', 'civil', 65, 'Block D', 'PZ-3', true),
  ('LAB-09', 'High Voltage & Machines Lab', 'EEE', 'electrical', 65, 'Block E', 'PZ-3', false),
  ('LAB-10', 'Smart Grid & Drives Lab', 'EEE', 'electrical', 65, 'Block E', 'PZ-3', true)
on conflict (id) do update set name = excluded.name, department = excluded.department, lab_type = excluded.lab_type, capacity = excluded.capacity, block = excluded.block, power_zone = excluded.power_zone, requires_network = excluded.requires_network;

-- 4. Campus Buses (8)
insert into public.ref_buses (id, name, route, capacity, student_load, linked_sections, linked_faculty) values
  ('BUS-01', 'Bus 1 — North Sector Express', 'North Sector Express', 75, 65, '["SEC-CSE-1", "SEC-ECE-2", "SEC-ME-1", "SEC-CE-2", "SEC-EEE-1"]'::jsonb, '["FAC-01", "FAC-03", "FAC-20"]'::jsonb),
  ('BUS-02', 'Bus 2 — Metro Hub Shuttle', 'Metro Hub Shuttle', 75, 68, '["SEC-CSE-2", "SEC-ECE-3", "SEC-ME-2", "SEC-CE-3", "SEC-EEE-2"]'::jsonb, '["FAC-07", "FAC-12", "FAC-39"]'::jsonb),
  ('BUS-03', 'Bus 3 — East Tech Corridor', 'East Tech Corridor', 75, 70, '["SEC-CSE-3", "SEC-ECE-4", "SEC-ME-3", "SEC-CE-4", "SEC-EEE-3"]'::jsonb, '["FAC-10", "FAC-23", "FAC-47"]'::jsonb),
  ('BUS-04', 'Bus 4 — Old City Terminal', 'Old City Terminal', 75, 81, '["SEC-CSE-1", "SEC-CSE-4", "SEC-ME-1", "SEC-ME-4", "SEC-EEE-1", "SEC-EEE-4"]'::jsonb, '["FAC-15", "FAC-28", "FAC-49"]'::jsonb),
  ('BUS-05', 'Bus 5 — South Ring Road', 'South Ring Road', 75, 66, '["SEC-CSE-2", "SEC-ECE-1", "SEC-ME-2", "SEC-CE-1", "SEC-EEE-2"]'::jsonb, '["FAC-18", "FAC-33"]'::jsonb),
  ('BUS-06', 'Bus 6 — West Lakeview Route', 'West Lakeview Route', 75, 68, '["SEC-CSE-3", "SEC-ECE-2", "SEC-ME-3", "SEC-CE-2", "SEC-EEE-3"]'::jsonb, '["FAC-25", "FAC-37"]'::jsonb),
  ('BUS-07', 'Bus 7 — Central Rail Link', 'Central Rail Link', 75, 71, '["SEC-CSE-4", "SEC-ECE-3", "SEC-ME-4", "SEC-CE-3", "SEC-EEE-4"]'::jsonb, '["FAC-30", "FAC-43"]'::jsonb),
  ('BUS-08', 'Bus 8 — Airport Highway Express', 'Airport Highway Express', 75, 54, '["SEC-ECE-1", "SEC-ECE-4", "SEC-CE-1", "SEC-CE-4"]'::jsonb, '["FAC-35", "FAC-45"]'::jsonb)
on conflict (id) do update set name = excluded.name, route = excluded.route, capacity = excluded.capacity, student_load = excluded.student_load, linked_sections = excluded.linked_sections, linked_faculty = excluded.linked_faculty;

-- 5. Hostels (4)
insert into public.ref_hostels (id, name, capacity, occupancy, power_zone, warden_id, warden_name, linked_sections) values
  ('HST-01', 'Aryabhata Boys Hostel', 320, 150, 'PZ-3', 'FAC-02', 'Dr. Kavita Nair', '["SEC-CSE-1", "SEC-ECE-1", "SEC-ME-1", "SEC-CE-1", "SEC-EEE-1"]'::jsonb),
  ('HST-02', 'Ramanujan Boys Hostel', 300, 165, 'PZ-3', 'FAC-12', 'Dr. Pooja Venkatesh', '["SEC-CSE-2", "SEC-ECE-2", "SEC-ME-2", "SEC-CE-2", "SEC-EEE-2"]'::jsonb),
  ('HST-03', 'Kalpana Chawla Girls Hostel', 280, 165, 'PZ-2', 'FAC-22', 'Dr. Rekha Choudhary', '["SEC-CSE-3", "SEC-ECE-3", "SEC-ME-3", "SEC-CE-3", "SEC-EEE-3"]'::jsonb),
  ('HST-04', 'Sarojini Girls Hostel', 280, 180, 'PZ-2', 'FAC-32', 'Dr. Vandana Mishra', '["SEC-CSE-4", "SEC-ECE-4", "SEC-ME-4", "SEC-CE-4", "SEC-EEE-4"]'::jsonb)
on conflict (id) do update set name = excluded.name, capacity = excluded.capacity, occupancy = excluded.occupancy, power_zone = excluded.power_zone, warden_id = excluded.warden_id, warden_name = excluded.warden_name, linked_sections = excluded.linked_sections;
