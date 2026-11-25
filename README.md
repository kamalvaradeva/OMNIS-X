
# OMNIS-X — JGIT Campus Digital Twin

## Project Description

OMNIS-X is a constraint-based institutional digital twin designed to detect, simulate and resolve operational disruptions in educational institutions.

It connects faculty, students, classrooms, laboratories, transportation and administrative resources to analyze cascading failures and dynamically generate recovery solutions.

The system also identifies potential vulnerabilities before failures occur and communicates updated schedules to affected students.

## Features

- Interactive campus dashboard and digital twin.
- Single and multiple disruption simulation.
- Live cascading failure propagation graph.
- Constraint-based recovery plan generation.
- Automatic timetable restructuring.
- Before vs. after recovery analysis.
- Zero-Failure Readiness Audit using N-1 and N-2 testing.
- Vulnerability Diagnostics.
- Preventive Improvement Testing.
- Administrator and student authentication.
- Student-specific updated timetables and notifications.
- Cloud database integration using Supabase.

## Technology Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Supabase (BaaS)
- Database: PostgreSQL
- Authentication: Supabase Auth
- Algorithms: BFS, Constraint-Based Recovery, Multi-Criteria Ranking
- Development IDE: Antigravity
- Hosting: Vercel

## Dependencies

- Modern web browser
- Live Server extension
- Supabase JavaScript SDK
- Supabase account
- Internet connection for cloud services
- Git (for cloning and version control)

Node.js and npm are not required for the current vanilla JavaScript architecture.

## Setup and Run Instructions

1. Clone or download this repository.
2. Open the project folder in Antigravity IDE or VS Code.
3. Create a Supabase project.
4. Configure the Supabase project URL and publishable key in `config.js`.
5. Execute the required database schema and SQL migrations in Supabase.
6. Configure administrator and student authentication accounts.
7. Open `index.html` using Live Server.
8. Access the application at:

   http://127.0.0.1:5500/

## Demo Credentials

### Administrator

- Email: admin@omnisx.com
- Password: OmnisX@2026

### Student

- Student ID: STU001
- Password: Student@2026

Demo accounts must be configured in Supabase before use.

## How It Works

1. Administrator selects an institutional disruption.
2. The system calculates cascading impacts using BFS.
3. The recovery engine generates suitable recovery plans.
4. Administrator selects and applies a recovery plan.
5. The timetable is automatically updated.
6. Applied changes are synchronized with Supabase.
7. Affected students receive updated schedules and notifications.
8. The Readiness Audit identifies potential future vulnerabilities.

## Novelty

OMNIS-X combines institutional digital twins, cascading failure simulation, intelligent recovery and proactive resilience testing into a single platform.

Its major innovations are:

- Zero-Failure Readiness Audit
- Vulnerability Diagnostics
- Preventive Improvement Testing

Unlike traditional college management systems, OMNIS-X focuses on both recovering from failures and preparing for future disruptions.

## Deployment

The application can be deployed on Vercel by importing the GitHub repository and selecting the Other framework preset.

Supabase provides cloud database and authentication services.

## Future Scope

- Integration with real-time institutional data.
- IoT-based infrastructure monitoring.
- Live transportation tracking.
- Integration with existing college ERP systems.

## Project Status

Hackathon prototype using sample institutional data and dynamically computed simulation results.

---

**OMNIS-X — A College That Cannot Afford a Single Operational Failure**

Detect → Analyze → Recover → Communicate → Prepare
