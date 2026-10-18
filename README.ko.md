# Ote

**내 컴퓨터에 두는 데일리 플래너. 하루 일정, 할 일, 프로젝트, 티켓, 목표, 다이어리를 한곳에 모읍니다.**

*Ote(오테)*는 일본어 お手, 강아지에게 "손!" 할 때 쓰는 말입니다. 늘 곁에서 손을 내미는 작고 똘똘한 도우미라는 뜻이고, **내 컴퓨터에** 삽니다. 가입도 클라우드도 없고, 데이터는 내 컴퓨터 밖으로 나가지 않습니다. 폰에서도 접속할 수 있습니다.

[English README](README.md)

![컴퓨터에서 본 Ote: 캘린더, 할 일, 오늘의 타임라인](docs/screenshots/home-desktop.png)

---

## 목차

1. [할 수 있는 것](#할-수-있는-것)
2. [설치 (원클릭)](#설치-원클릭)
3. [Ote 처음 써 보기](#ote-처음-써-보기)
4. [폰에서 쓰기](#폰에서-쓰기)
5. [업데이트 · 삭제 · 백업](#업데이트--삭제--백업)
6. [문제 해결](#문제-해결)
7. [캘린더 연결](#캘린더-연결)
8. [쓰던 업무 도구와 연결하기](#쓰던-업무-도구와-연결하기)
9. [개발자용](#개발자용)
10. [라이선스](#라이선스)

---

## 할 수 있는 것

| | |
| --- | --- |
| ![할 일과 티켓을 담은 프로젝트](docs/screenshots/projects.png) | **프로젝트.** 하나의 목표를 위한 할 일과 티켓을 마감일, 진행률과 함께 묶습니다. 다 끝나면 완료 처리합니다. |
| ![티켓 칸반 보드](docs/screenshots/tickets.png) | **티켓.** 큰 단위의 일을 칸반 보드로 관리합니다. 입력창에 `#Website`처럼 쓰면 그 프로젝트에 티켓이 만들어집니다. |
| ![한 달치 다이어리](docs/screenshots/diary.png) | **다이어리.** 하루에 한 줄 메모를 남기고, 목록이나 달력으로 봅니다. |

| | |
| --- | --- |
| ![오늘: 계획과 실제를 나란히](docs/screenshots/today.png) | **오늘.** 왼쪽에 계획, 오른쪽에 실제로 한 일이 한 시간에 한 줄씩 나란히 보입니다.<br><br>빈 곳을 드래그하면 블록이 생기고, 블록을 끌면 옮겨지고, 가장자리를 끌면 길이가 바뀝니다.<br><br>캘린더 일정(점선 블록)도 함께 보여서, 누르면 바로 계획으로 바꿀 수 있습니다. 계획이 끝나면 했는지 물어보게 할 수도 있습니다. |
| ![리뷰: 계획과 실제가 얼마나 맞았는지](docs/screenshots/review.png) | **리뷰.** 주·월·년 단위로 두 가지 점수를 보여 줍니다.<br>• **제시간(On time %)**: 계획한 일을 계획한 시간에 했는지<br>• **달성률(Attainment %)**: 시간은 달라도 결국 했는지<br><br>요일별, 활동별로 나뉘고, 지난 기간과 나란히 비교됩니다. |
| ![기록에서 저절로 채워지는 목표](docs/screenshots/goals.png) | **목표.** "이번 주 일 25시간", "운동 4번", "독서 5시간", "매일 제시간에 시작하기" 같은 목표를 세웁니다.<br><br>기록한 대로 저절로 채워집니다. |

이 밖에도 다음 기능이 있습니다.
- 검색되는 주간·월간 **캘린더**
- **뽀모도로 타이머**
- **되돌리기/다시 하기**(⌘Z / ⌘⇧Z)
- **다크 모드**
- 말로 일정을 고쳐 주는 **채팅 도우미**(선택 기능, 예: "내일 7시에 운동 1시간 넣어줘")
- 지금 하는 계획을 보여 주는 **Mac 메뉴 막대** 앱

<p align="center"><img src="docs/screenshots/calendar.png" width="300" alt="폰에서 본 캘린더"> &nbsp; <img src="docs/screenshots/home-desktop-dark.png" width="560" alt="다크 모드"></p>

---

## 설치 (원클릭)

서버를 몰라도 됩니다. 설치 프로그램이 다음을 알아서 합니다.
- 필요한 것을 모두 받습니다(Ote를 돌리는 엔진인 Node.js 포함).
- 컴퓨터를 켜면 Ote가 저절로 실행되게 설정합니다.
- 브라우저로 Ote를 열어 줍니다.

처음 설치할 때 5분 정도 걸립니다.

### 1. 다운로드

이 페이지 위쪽의 초록색 **Code** 버튼 → **Download ZIP**을 누릅니다. 받은 ZIP 파일을 더블클릭해 압축을 풉니다. 폴더는 어디에 두어도 됩니다(다운로드 폴더 그대로도 괜찮습니다).

### 2. 설치 프로그램 실행

<table>
<tr><th>macOS</th><th>Windows</th><th>Linux</th></tr>
<tr valign="top">
<td>

**`Install Ote.command`**를 더블클릭합니다.

"악성 소프트웨어가 있는지 확인할 수 없습니다"라고 나오면:
1. **시스템 설정 → 개인정보 보호 및 보안**을 엽니다.
2. 아래로 내려 **그래도 열기**를 누릅니다.
3. 파일을 다시 더블클릭합니다.

</td>
<td>

**`Install Ote.cmd`**를 더블클릭합니다.

"Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**을 누릅니다.

</td>
<td>

압축을 푼 폴더에서 터미널로 실행합니다.

```bash
bash "Install Ote.command"
```

</td>
</tr>
</table>

### 3. 질문 하나에 답하기

설치 프로그램이 Ote를 어떻게 쓸지 묻습니다.

```
Do you want to use Ote on your phone or another computer too?
  1) Not now — only on this computer (no password needed)
  2) Yes, with Tailscale — private, works anywhere (free app on both devices)
  3) Yes, on the same Wi-Fi — simplest, needs a password, only at home
```

| 선택 | 뜻 |
| --- | --- |
| 1 | 이 컴퓨터에서만 씁니다. 비밀번호가 필요 없습니다. |
| 2 | Tailscale로 폰에서도 씁니다. 어디서나 되고, 내 기기만 들어올 수 있습니다. |
| 3 | 같은 Wi‑Fi에서 폰으로 씁니다. 가장 간단하지만 비밀번호가 필요하고, 집에서만 됩니다. |

잘 모르겠으면 **1**을 고르세요. 나중에 설치 프로그램을 다시 실행해서 언제든 바꿀 수 있습니다([폰에서 쓰기](#폰에서-쓰기) 참고).

### 4. 끝

설치가 끝나면 브라우저에 Ote가 열립니다. 주소는 설치 프로그램이 알려 주며, 보통 **http://localhost:3000**입니다. 즐겨찾기에 넣어 두세요.

```
✓ Ote is installed and running.

  On this computer:  http://localhost:3000

  It starts by itself when you turn on the computer.
```

---

## Ote 처음 써 보기

1. **하루가 시작되는 시각 정하기.** 톱니바퀴 아이콘 → **Time**에서 **Day start time**(예: 05:00)과 **Week starts on**(한 주의 시작 요일)을 정합니다.
2. **활동 살펴보기.** 모든 블록은 활동 하나에 속합니다. 처음에는 Sleep, Work, Exercise, Reading, Travel, Meal, Commute, Other가 있습니다. 이름이나 색을 바꾸거나 새로 추가하려면 **Activities**에서 합니다.
3. **계획하기.** **Today**(컴퓨터에서는 **Home**)를 엽니다. **Plan** 열의 빈 곳을 아래로 드래그하고, 활동을 고른 뒤 저장합니다.
4. **기록하기.** **Actual** 열에도 같은 방법으로 실제로 한 일을 적습니다. 알림을 받고 싶다면 설정 → Notification defaults → **End confirmation**을 켜세요. 계획이 끝날 때 했는지 묻고(✓ / ✕), ✓를 누르면 대신 기록해 줍니다.
5. **캘린더 연결**(선택). 설정 → Accounts에서 연결하면 회의 일정이 계획 옆에 보입니다. [캘린더 연결](#캘린더-연결)을 참고하세요.
6. **며칠 써 본 뒤**, **Review**에서 계획과 실제 하루를 비교해 보고 **Goals**에서 목표를 몇 개 세워 보세요.

---

## 폰에서 쓰기

Ote는 내 컴퓨터에서 돌아가기 때문에, 폰이 그 컴퓨터에 닿을 방법이 필요합니다. 설치 프로그램을 다시 실행해서 둘 중 하나를 고르세요.

| | **Tailscale** (추천) | **같은 Wi‑Fi** |
| --- | --- | --- |
| 되는 곳 | 어디서나(회사, 데이터 통신) | 집 Wi‑Fi에서만 |
| 보안 | 내 기기만 접속 가능 | 같은 Wi‑Fi의 누구나 로그인 화면까지는 들어옴 |
| 비밀번호 | 다른 기기에서만 | 이 컴퓨터를 포함해 모든 기기에서 |
| 준비 | 두 기기에 무료 Tailscale 앱 설치 | 없음 |

**Tailscale로 쓰기:**
1. 컴퓨터와 폰에 [Tailscale](https://tailscale.com/download)을 깔고, 두 기기 모두 **같은 계정**으로 로그인합니다.
2. 설치 프로그램을 다시 실행하고 **2**를 고르면, `https://내컴퓨터.tail1234.ts.net` 같은 폰용 주소를 알려 줍니다.
3. HTTPS가 꺼져 있다는 안내가 나오면 Tailscale 관리 콘솔 → **DNS**에서 **HTTPS Certificates**를 켜고 설치 프로그램을 한 번 더 실행합니다.

**같은 Wi‑Fi로 쓰기:** 설치 프로그램을 다시 실행해 **3**을 고르면 `http://192.168.1.20:3000` 같은 주소를 알려 줍니다. 컴퓨터가 "node"의 수신 연결을 허용할지 물으면 **허용**을 누르세요.

어느 쪽이든 설치 프로그램이 다른 기기용 **비밀번호**를 만들어 줍니다(직접 정해도 됩니다). 그다음 폰 홈 화면에 추가하면 앱처럼 열립니다.
- **iPhone:** Safari에서 **공유 → 홈 화면에 추가**
- **Android:** Chrome 메뉴 → **앱 설치**

> 폰에서 쓰려면 컴퓨터가 켜져 있어야 합니다(잠자기 상태면 접속되지 않습니다).

---

## 업데이트 · 삭제 · 백업

- **업데이트:** 새 ZIP을 받아서 설치 프로그램을 다시 실행합니다. 데이터와 설정은 그대로 남습니다.
- **삭제:** **`Uninstall Ote.command`**(Windows는 `Uninstall Ote.cmd`)를 더블클릭합니다. 데이터는 폴더에 그대로 남습니다. 데이터까지 지우려면 그 폴더를 직접 지우거나, 터미널에서 `--purge`를 붙여 실행합니다.
- **백업:** 설정 → Data → **Export backup**을 누르면 모든 데이터가 파일 하나로 저장됩니다. **Import backup**으로 되살립니다.

모든 것은 한 폴더에 있습니다.

| | 폴더 |
| --- | --- |
| macOS | `~/Library/Application Support/Ote` |
| Windows | `%LOCALAPPDATA%\Ote` |
| Linux | `~/.local/share/ote` |

| 폴더 안 | 내용 |
| --- | --- |
| `data/` | 계획, 메모 등 모든 데이터. 이 폴더를 백업하세요. |
| `config.env` | 설정과 비밀번호 |
| `logs/` | 문제가 생겼을 때 볼 기록 |
| `app/` | 프로그램 자체. 업데이트할 때마다 새로 바뀝니다. |

---

## 문제 해결

| 증상 | 해결 |
| --- | --- |
| 브라우저에서 연결할 수 없다고 나옴 | Ote는 컴퓨터가 켜지고 몇 초 뒤에 시작됩니다. 잠시 기다렸다가 새로고침하세요. 계속 안 되면 설치 프로그램을 다시 실행합니다. |
| 폰에서 접속이 안 됨 | 컴퓨터가 켜져 있고 잠자기 상태가 아닌지 확인하세요. Tailscale이라면 두 기기 모두 연결돼 있는지, Wi‑Fi라면 같은 네트워크인지 확인합니다. |
| 비밀번호를 잊어버림 | `config.env`(위 표 참고)에서 `OTE_PASSWORD`를 확인하거나 바꾸고, 설치 프로그램을 다시 실행합니다. |
| 설치 중 오류로 멈춤 | 인터넷 연결을 확인하고 다시 실행하세요. 자세한 내용은 `logs/install.log`에 있습니다. |
| "Can't decrypt saved calendar connections" | `config.env`의 `OTE_SECRET`이 바뀐 경우입니다. 원래 값으로 되돌리거나, `data/integrations.json`을 지우고 캘린더를 다시 연결합니다. |
| 그 밖의 문제 | `logs/server.log`를 확인하고, 증상과 함께 [이슈](../../issues)를 남겨 주세요. |

---

## 캘린더 연결

캘린더 일정은 계획 옆에 보이기만 하고, Ote가 바꾸지 않습니다. 단, 계획을 저장하겠다고 고른 Mac 캘린더에는 Ote가 일정을 씁니다.

- **Google 캘린더:** iCal 링크로 연결하는 게 가장 쉽습니다. Google 캘린더에서 해당 캘린더의 **설정 → 캘린더 통합**으로 가서 **iCal 형식의 비공개 주소**를 복사합니다. Ote의 **설정 → Add calendar by iCal link**에 붙여 넣으면 됩니다.
- **iCloud:** [appleid.apple.com](https://appleid.apple.com)의 **로그인 및 보안 → 앱 암호**에서 앱 전용 암호를 만든 뒤, **설정 → Connect Apple (iCloud) Calendar**에서 연결합니다.
- **Mac 캘린더 앱의 모든 캘린더**(macOS): 공유 캘린더와 회사 캘린더까지 포함됩니다. 처음 한 번 `zsh tools/ekexport/build.sh`로 작은 도우미를 빌드하고(Xcode 명령줄 도구 필요), **설정 → Accounts → This Mac's calendars**를 켭니다. 계획을 Mac 캘린더에 저장할 수도 있습니다.
- **나에게 공유된 Google 캘린더:** `scripts/google-calendar-ics.gs`로 iCal 링크를 만들 수 있습니다(방법은 파일 안에 있습니다).

---

## 쓰던 업무 도구와 연결하기

Ote는 혼자서도 모든 기능이 됩니다. 이미 쓰는 서비스가 있다면 **커넥터**로 연결해서 서로 맞춰 둘 수 있습니다.
- 그 서비스의 할 일이 Ote의 할 일과 양방향으로 동기화됩니다(시작·끝 시각이 있는 할 일은 계획이 됩니다).
- 나에게 배정된 티켓이 설명, 기록, 댓글과 함께 티켓 보드에 나옵니다.
- 그 서비스의 캘린더가 보이고, 로그인에도 쓸 수 있습니다.

연결하는 방법은 두 가지입니다.
- **Ote 코드를 고치지 않고:** 내 서버에 간단한 JSON API 몇 개를 만들고, **설정 → Connector → REST server**에서 연결합니다.
- **자체 API가 있는 서비스**(Todoist, Linear, GitHub Issues 등): 작은 TypeScript 커넥터를 씁니다.

자세한 내용은 [`src/lib/server/connectors/README.md`](src/lib/server/connectors/README.md)에 있고, `scripts/mock-connector.mjs`가 완성된 예시 서버입니다.

---

## 개발자용

소스로 직접 실행하는 방법, 로그인이 동작하는 방식, Google OAuth 설정, 예시 데이터로 체험하기, 테스트, 폴더 구조는 [영어 README의 For developers](README.md#for-developers)에 정리되어 있습니다.

간단히 하면 이렇습니다(Node.js 20.9 이상 필요).

```bash
git clone https://github.com/dryxco/ote-planner.git && cd ote-planner
npm install
npm run setup     # .env.local에 비밀번호와 암호화 키를 만들어 줍니다
npm run build
npm start         # http://localhost:3000 — 이 컴퓨터에서는 로그인 없이 열립니다
```

---

## 라이선스

Copyright © 2026 [dryxco](https://github.com/dryxco). [PolyForm Noncommercial 1.0.0](LICENSE.md) 라이선스를 따릅니다.

개인 용도, 공부, 연구, 취미 프로젝트, 비영리·교육·공공 기관 등 **비상업적 목적**이라면 자유롭게 쓰고, 고치고, 나눌 수 있습니다. **상업적 이용은 허용하지 않습니다.** 상업적으로 쓰려면 별도 라이선스를 문의해 주세요.
