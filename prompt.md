    Artificial Intelligence-Based Student Interaction Analytics System
    # ACIAS - AI Classroom Interaction Analytics System
    The system is built to collect, analyze, and evaluate student interaction levels during the learning process through computer vision, natural language processing, and speech recognition. Data is aggregated in real time to support teachers in managing the classroom and provide an objective basis for evaluating the learning process.
    ## I. Overall Architecture
    The system is divided into six independent layers.
    $$\text{Presentation} \to \text{Application} \to \text{AI Processing} \to \text{Business Logic} \to \text{Data Access} \to \text{Storage}$$
    In which:
    - **Presentation Layer:** Web/App interface.
    - **Application Layer:** manages users, classes, questions, and sessions.
    - **AI Processing Layer:** Processes images, audio, and behavior recognition.
    - **Business Logic Layer:** Coordinates business processes.
    - **Data Access Layer:** Retrieves data.
    - **Storage Layer:** SQLite and local file storage systems.
    ## II. Functional Subsystems
    ### A. User Management
    Functions:
    - Account authentication
    - Profile management
    - Permission assignment
    - Activity log
    - Role management
    Permission assignment model based on **RBAC (Role-Based Access Control)**.
    ```
    Admin [0]
    ├── Homeroom Teacher [1a]
    │ └── Parent [1b]
    ├── Subject Teacher [2]
    ├── Student [3]
    └── Guest [4]
    ```
    ### B. Classroom Management
    Supports data import from:
    - Excel
    - CSV
    - Direct import
    Manages:
    - Class list
    - Seating chart
    - Seat change history
    - Student profile
    ### C. Question Bank
    Supports three question types:
    - Multiple choice
    - True/False
    - Short answer
    Each question includes:
    - content
    - answer
    - difficulty level
    - subject
    - duration
    - voice recognition keywords
    ### D. Session Management
    A session Includes:
    ```
    Lesson
    ├── Teacher
    ├── Subject
    ├── Class
    ├── Questions
    ├── Student Responses
    └── Reports
    ```
    All events are marked with a **Timestamp**.
    ## III. AI System
    ### A. Audio Recognition
    Pipeline:
    $$
    Audio stream to Voice activity detection to Speech recognition to Command recognition to Question matching
    $$
    Functions:
    - Teacher recognition
    - Command recognition
    - Question identification
    - Start/end answering session
    ### B. Image Recognition
    Pipeline:
    $$
    Video stream to Person Detection to Seat Tracking to Pose Estimation to Hand Detection to Finger Counting to Answer Recognition
    $$
    The system prioritizes Seat Tracking over facial recognition to reduce biometric data requirements and increase security. ### C. Identifying Answers
    Type 1: Counting fingers (1 → A, 2 → B, 3 → C, 4 → D)
    Type 2: Counting fingers; Left/Right hand (Configured by the teacher)
    Type 3: Identifying students who raise their hands → Prioritizing scoring system -> Suggesting calling on students to answer
    We have 3 sets: `X` - participation frequency, `Y` - Current capabilities, `Z` - Reaction speed
    Mapping the above 3 sets into the corresponding sets `X'`,`Y'`,`Z'` so that all values ​​belong to the range 0 and 1
    $$
    X'_i = \frac{\text{max}(X)-X_{i}}{\text{max}(X)-\text{min}(X)};
    Y'_i = \frac{Y_{i}-\text{min}(Y)}{\text{max}(Y)-\text{min}(Y)};
    Z'_{i} = \frac{\text{max}(Z)-Z_{i}}{\text{max}(Z)-\text{min}(Z)}
    $$
    Let's assign a point value to each question:
    - If A is large (difficult question, high value): prioritize those with good ability (high Y) and quick reflexes (high Z) to optimize the probability of getting it right early. Limit calling on those who are quiet (low X) to avoid putting pressure on them.
    - If A is small (easy question, encouraging): Prioritize those with low scores (low Y) and who speak less (high X) to create motivation and balance the class.
    $$
    S_i = \alpha\times Z'_i + \beta\times X'_i + \gamma\times\frac{A}{A_{max}} × Y'_i + \delta\times\frac{1 - A}{A_{max}}\times(1 - Y'_i)
    $$
    where:
    - $A_{max}$ is the maximum possible score for the question (e.g., 10 or 20).
    - `α`, `β`, `γ`, `δ` are weights you set yourself (default suggestions: `α = 0.3`, `β = 0.3`, `γ = 0.2`, `δ = 0.2`).
    ## IV. Analysis System
    Data is processed by:
    - Question
    - Lesson
    - Day
    - Week
    - Month
    - Semester
    - School Year
    Key Indicators:
    - Participation Rate
    - Correct Answer Rate
    - Response Time
    - Level of Activeness
    - Level of Interaction
    - Frequency of Speaking
    - Stability Index
    - Trends Over Time
    The system automatically detects:
    - Students with low interaction
    - Students who consistently give incorrect answers
    - Students showing signs of decreased interaction
    - Outstanding Students
    ## V. Data Management
    The database consists of entity groups Main:
    ```
    Users
    Roles
    Permissions

    Classes
    Students
    Parents

    Subjects
    Lessons
    Questions
    QuestionBank

    Answers
    Interactions

    Seats
    SeatHistory

    Attendance

    Reports
    Appeals

    Devices

    AuditLogs
    Statistics
    ```
    All operations are logged via **Audit Log** for auditing and tracing purposes.
    ## VI. Business Processes
    $$\text{Initialize class} \to \text{Import student list} \to \text{Set up seating chart} \to \text{Initialize lesson} \to \text{AI recognizes questions} \to \text{Collect feedback} \to \text{Process AI} \to \text{Save data} \to \text{Analyze Statistics} \to \text{Generate Report} \to \text{Export Data}$$
    ## VII. Deployment Architecture
    ```
    Frontend React └── REST API / WebSocket / SSE
    Backend
    └── NodeJS
    Business Service
    AI Engine
    SQLite
    File Storage
    ```
    Input Devices:
    - Webcam
    - IP Camera
    - Smartphone
    - USB Camera
    - Microphone
    - Audio Recording Device
    ## VIII. Security
    The system applies the following mechanisms:
    - RBAC (Role-Based Access Control)
    - Password encryption using strong hashing algorithms
    - Session authentication
    - Audit Log
    - Data backup and recovery
    - Encryption of sensitive data
    - Access control by class and subject