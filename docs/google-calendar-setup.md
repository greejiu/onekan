# Google 캘린더 연동 설정

오늘한칸의 Google 캘린더 연동은 브라우저에 Google 비밀키를 노출하지 않고 Supabase Edge Function을 통해 동작한다.

## 1. Google Cloud 준비

1. Google Cloud Console에서 프로젝트를 만든다.
2. **Google Calendar API**를 사용 설정한다.
3. OAuth 동의 화면의 사용자 유형을 **외부**로 설정한다.
4. 개발 중에는 게시 상태를 **테스트**로 두고 연결할 Google 계정을 테스트 사용자에 추가한다.
5. OAuth 클라이언트 ID를 **웹 애플리케이션** 유형으로 만든다.

승인된 리디렉션 URI에는 다음 주소를 정확히 등록한다.

```text
https://mmpsyajgyufdxmmnxqba.supabase.co/functions/v1/google-calendar-auth
```

승인된 JavaScript 원본에는 다음 주소를 등록한다.

```text
https://greejiu.github.io
```

## 2. Supabase 비밀 설정

Supabase 프로젝트 `when-did-i-do-it`의 Edge Functions secrets에 다음 값을 저장한다.

```text
GOOGLE_CLIENT_ID=<Google에서 발급한 클라이언트 ID>
GOOGLE_CLIENT_SECRET=<Google에서 발급한 클라이언트 보안 비밀>
APP_URL=https://greejiu.github.io/onekan/
```

`GOOGLE_TOKEN_ENCRYPTION_KEY`는 선택 사항이다. 설정하지 않으면 Edge Function이 서버 전용 Supabase 키에서 Google 토큰 암호화 키를 파생한다. 별도 키를 사용할 경우 base64url 형식의 32바이트 난수를 사용한다.

비밀값은 GitHub 저장소, 브라우저 코드, 이 문서에 기록하지 않는다.

## 3. 동작 확인

1. 오늘한칸에 로그인한다.
2. **설정 → Google 캘린더 → Google 캘린더 연결**을 누른다.
3. Google 권한 화면에서 테스트 사용자 계정으로 승인한다.
4. 기본 캘린더만 자동으로 표시되는지 확인한다.
5. 다른 캘린더의 눈 아이콘을 켜고 일정이 나타나는지 확인한다.
6. Google 일정 색상과 개별 일정 색상이 유지되는지 확인한다.
7. 연결을 해제한 뒤 Google 원본 일정이 그대로 남아 있는지 확인한다.

정식 공개 전에는 개인정보처리방침, 서비스 도메인 소유권 확인, Google OAuth 앱 검증을 완료해야 한다.
