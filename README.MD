# ACIAS - AI Classroom Interaction Analytics System
Hệ thống phân tích tương tác học sinh trong lớp học dựa trên Trí tuệ nhân tạo.
Hệ thống được xây dựng nhằm thu thập, phân tích và đánh giá mức độ tương tác của học sinh trong quá trình học tập thông qua thị giác máy tính, xử lý ngôn ngữ tự nhiên và nhận dạng giọng nói. Dữ liệu được tổng hợp theo thời gian thực nhằm hỗ trợ giáo viên điều hành lớp học và cung cấp cơ sở khách quan cho việc đánh giá quá trình học tập.
## I. Kiến trúc tổng thể

Hệ thống được chia thành sáu tầng độc lập:
$$ \text{Presentation} \to \text{Application} \to \text{AI Processing} \to \text{Business Logic} \to \text{Data Access} \to \text{Storage} $$
Trong đó:
- **Presentation Layer:** Giao diện Web/App.
- **Application Layer:** Quản lý người dùng, lớp học, câu hỏi và phiên học.
- **AI Processing Layer:** Xử lý hình ảnh, âm thanh và nhận dạng hành vi.
- **Business Logic Layer:** Điều phối quy trình nghiệp vụ.
- **Data Access Layer:** Truy xuất dữ liệu.
- **Storage Layer:** SQLite và hệ thống lưu trữ tệp cục bộ.
## II. Các phân hệ chức năng
### A. Quản lý người dùng
**Chức năng:**
- Xác thực tài khoản
- Quản lý hồ sơ
- Phân quyền
- Nhật ký hoạt động
- Quản lý vai trò
Mô hình phân quyền theo **RBAC (Role-Based Access Control)**:
```text
Admin [0]
├── Homeroom Teacher [1a]
│      └── Parent [1b]
├── Subject Teacher [2]
├── Student [3]
└── Guest [4]
```
### B. Quản lý lớp học
**Hỗ trợ nhập dữ liệu từ:**
- Excel
- CSV
- Nhập trực tiếp
**Quản lý:**
- Danh sách lớp
- Sơ đồ chỗ ngồi
- Lịch sử thay đổi vị trí
- Hồ sơ học sinh
### C. Kho câu hỏi
**Hỗ trợ ba loại câu hỏi:**
- Trắc nghiệm nhiều lựa chọn
- Đúng/Sai
- Trả lời ngắn
**Mỗi câu hỏi gồm:**
- Nội dung
- Đáp án
- Mức độ
- Môn học
- Thời lượng
- Từ khóa nhận diện bằng giọng nói
### D. Quản lý phiên học
Một phiên học gồm:
```text
Lesson
├── Teacher
├── Subject
├── Class
├── Questions
├── Student Responses
└── Reports
```
Mọi sự kiện đều được gắn **Timestamp**.
## III. Hệ thống AI
### A. Nhận dạng âm thanh
**Pipeline:**
$$ \text{Audio stream} \to \text{Voice activity detection} \to \text{Speech recognition} \to \text{Command recognition} \to \text{Question matching} $$
**Chức năng:**
- Nhận biết giáo viên
- Nhận dạng câu lệnh
- Xác định câu hỏi
- Bắt đầu/kết thúc phiên trả lời
### B. Nhận dạng hình ảnh
**Pipeline:**
$$ \text{Video Stream} \to \text{Person Detection} \to \text{Seat Tracking} \to \text{Pose Estimation} \to \text{Hand Detection} \to \text{Finger Counting} \to \text{Answer Recognition} $$
Hệ thống ưu tiên **Seat Tracking** thay vì nhận diện khuôn mặt nhằm giảm yêu cầu dữ liệu sinh trắc học và tăng tính bảo mật.
### C. Nhận diện câu trả lời
- **Loại 1:** Đếm số ngón tay (1 → A, 2 → B, 3 → C, 4 → D).
- **Loại 2:** Đếm số ngón tay; Tay trái/ phải (Do giáo viên cấu hình).
- **Loại 3:** Nhận diện học sinh giơ tay → Hệ thống tính điểm ưu tiên → Đề xuất gọi phát biểu.
Ta có 3 tập hợp: 
- `X` - Participation frequency (Tần suất tham gia)
- `Y` - Current capabilities (Năng lực hiện tại)
- `Z` - Reaction speed (Tốc độ phản xạ)
Ánh xạ 3 tập hợp trên thành tập `X'`, `Y'`, `Z'` tương ứng sao cho mọi giá trị thuộc đoạn [0, 1]:
$$ X'_i = \frac{\max(X)-X_{i}}{\max(X)-\min(X)} $$
$$ Y'_i = \frac{Y_{i}-\min(Y)}{\max(Y)-\min(Y)} $$
$$ Z'_i = \frac{\max(Z)-Z_{i}}{\max(Z)-\min(Z)} $$
Ta đặt số điểm của câu hỏi là $A$, ta có:
- **Nếu $A$ lớn (câu hỏi khó, giá trị cao):** Ưu tiên người có năng lực tốt ($Y$ cao) và phản xạ nhanh ($Z$ cao) để sớm tối ưu xác suất đúng. Hạn chế gọi người ít nói ($X$ thấp) để tránh gây áp lực.
- **Nếu $A$ nhỏ (câu hỏi dễ, khuyến khích):** Ưu tiên người có điểm thấp ($Y$ thấp) và ít phát biểu ($X$ cao) để tạo động lực và cân bằng lớp học.
**Công thức tính điểm ưu tiên $S_i$:**
$$ S_i = \alpha \times Z'_i + \beta \times X'_i + \gamma \times \frac{A}{A_{max}} \times Y'_i + \delta \times \frac{1 - A}{A_{max}} \times (1 - Y'_i) $$
Trong đó:
- $A_{max}$ là điểm số tối đa có thể có của câu hỏi (ví dụ 10 hoặc 20).
- $\alpha$, $\beta$, $\gamma$, $\delta$ là trọng số cấu hình (mặc định gợi ý: $\alpha = 0.3$, $\beta = 0.3$, $\gamma = 0.2$, $\delta = 0.2$).
## IV. Hệ thống phân tích
**Dữ liệu được xử lý theo từng:**
- Câu hỏi
- Tiết học
- Ngày, Tuần, Tháng
- Học kỳ
- Năm học
**Các chỉ số chính:**
- Tỷ lệ tham gia
- Tỷ lệ trả lời đúng
- Thời gian phản hồi
- Mức độ chủ động
- Mức độ tương tác
- Tần suất phát biểu
- Chỉ số ổn định
- Xu hướng thay đổi theo thời gian
**Hệ thống tự động phát hiện:**
- Học sinh ít tương tác
- Học sinh trả lời sai liên tục
- Học sinh có dấu hiệu giảm tương tác
- Học sinh nổi bật
## V. Quản lý dữ liệu
**Cơ sở dữ liệu gồm các nhóm thực thể chính:**
```text
Users / Roles / Permissions
Classes / Students / Parents
Subjects / Lessons
Questions / QuestionBank
Answers / Interactions
Seats / SeatHistory
Attendance
Reports / Appeals
Devices
AuditLogs
Statistics
```
Toàn bộ thao tác được lưu thông qua **Audit Log** để phục vụ kiểm tra và truy vết.
## VI. Quy trình nghiệp vụ
$$ \text{Khởi tạo lớp học} \to \text{Nhập danh sách học sinh} \to \text{Thiết lập sơ đồ chỗ ngồi} \to \text{Khởi tạo tiết học} \to \text{AI nhận diện câu hỏi} \to \text{Thu thập phản hồi} \to \text{Xử lý AI} \to \text{Lưu dữ liệu} \to \text{Phân tích thống kê} \to \text{Sinh báo cáo} \to \text{Xuất dữ liệu} $$
## VII. Kiến trúc triển khai
```text
Frontend React 
└── REST API / WebSocket / SSE

Backend
├── NodeJS 
├── Business Service
└── AI Engine 

Storage
├── SQLite 
└── File Storage
```
**Thiết bị đầu vào:**
- Webcam
- Camera IP
- Điện thoại thông minh
- Camera USB
- Microphone
- Thiết bị ghi âm
## VIII. Bảo mật
**Hệ thống áp dụng các cơ chế:**
- RBAC (Role-Based Access Control)
- Mã hóa mật khẩu bằng thuật toán băm mạnh
- Xác thực phiên làm việc
- Nhật ký kiểm toán (Audit Log)
- Sao lưu và phục hồi dữ liệu
- Mã hóa dữ liệu nhạy cảm
- Phân quyền truy cập theo lớp học và môn học
