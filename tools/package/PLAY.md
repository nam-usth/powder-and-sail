# Isles of War — bản thử nghiệm

## Cách chạy (cần Node.js 18+ hoặc Python 3)

Game dùng ES modules nên **không mở trực tiếp file index.html được** — cần một server tĩnh nhỏ (đã kèm sẵn).

- **Windows:** nhấp đúp `Choi-game-Windows.bat` → trình duyệt tự mở `http://localhost:8080/frontend/`
- **macOS / Linux:** mở Terminal trong thư mục này, chạy `sh choi-game.sh`
- **Không có Node.js:** `python -m http.server 8080` trong thư mục này, rồi mở `http://localhost:8080/frontend/`

Trình duyệt khuyến nghị: Chrome / Edge / Firefox bản mới (WebGL 2).

## Các chế độ
- `http://localhost:8080/frontend/` — **Đảo nhà (Harbor)**, mặc định
- Từ Harbor bấm **Ra khơi (W)** → Hải đồ → chọn nhiệm vụ & tàu → **Hải chiến**
- `http://localhost:8080/frontend/?mode=skirmish` — **Open War** (trận RTS cổ điển)
- `http://localhost:8080/test/` — bộ test tự động

## Mẹo
- **Q**: đổi đồ hoạ HIGH/LOW · **Y**: Xưởng tàu · **?**: điều khiển
- Tiến trình lưu trong trình duyệt (localStorage, khoá `iow_profile_v1`). Muốn chơi lại từ đầu: mở DevTools → Application → Local Storage → xoá `iow_profile_v1`.
- Đặc tả đầy đủ và danh sách test thủ công: `docs/SPECIFICATION.md`.
