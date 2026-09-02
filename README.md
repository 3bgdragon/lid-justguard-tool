# LET IT DIE 저스트가드 패치 도구

LET IT DIE Steam 오프라인판 5.0.1.0의 일반 저스트가드 판정 강도와 성공 시 상대 그로기 판정을 선택해 적용하고 복원하는 Windows용 도구입니다.

> Windows 전용 · Steam 오프라인판 5.0.1.0 전용 · Node.js 18 이상 필요

## 사용법

1. LET IT DIE를 완전히 종료합니다.
2. `run.bat`을 더블클릭합니다. 게임 폴더 수정 권한을 위한 Windows 관리자 확인 창이 표시됩니다.
3. `설정 적용`에서 저스트가드 강도와 그로기 ON/OFF를 선택합니다.

Steam 라이브러리를 읽어 설치 폴더를 자동 탐색합니다. 자동 탐색에 실패하면 명령줄의 `--game` 옵션으로 직접 지정할 수 있습니다.

## 저스트가드 강도

| 설정 | 가드 준비 | 판정 시작 | 유지시간 | 고급 무기 확률 제한 |
|---|---:|---:|---:|---|
| 순정 | 63ms | 103ms | 0.104초 | 순정 |
| 완화 | 40ms | 60ms | 0.850초 | 해제 |
| 넓게 | 25ms | 35ms | 1.000초 | 해제 |
| 다리미급 | 15ms | 20ms | 1.200초 | 해제 |

그로기 `ON`은 직접 근접 공격한 상대에게 게임의 정식 `BrgDamageType_Groggy` 반응을 적용합니다. 투사체를 저스트가드한 경우 원거리 발사자에게 그로기가 전달되지는 않습니다. `OFF`는 순정 `Flip` 반응으로 되돌립니다.

## 안전 장치와 복원

- 실행 중인 게임이 있으면 패치와 복원을 중단합니다.
- 지원하는 원본/도구 생성 파일의 SHA-1만 수정합니다.
- 게임 원본 파일이나 원본 청크를 포함하지 않고, 합법적으로 설치된 게임에만 적용되는 XOR 델타를 사용합니다.
- 패치 데이터 범위, 결과 파일 크기, 결과 SHA-1을 적용 전에 검증합니다.
- 실행 파일 안의 UPK 해시 항목도 함께 갱신하고 재검증합니다.
- 설정을 변경하기 전에 대상 파일 3개를 `backups/<시각>` 폴더에 자동 백업합니다.
- `최신 백업 복원`은 복원 직전 상태를 다시 안전 백업한 후 복원합니다.
- 한 백업은 약 240MB입니다.

`순정 + 그로기 OFF`를 적용하면 이 도구가 수정한 저스트가드 시간, 확률 제한 해제, 그로기 변경을 순정 상태로 되돌립니다. 다른 도구가 같은 UPK 파일을 수정했다면 SHA-1 검증에서 안전하게 중단합니다.

## 공개 배포 및 권리 고지

이 프로젝트는 비공식 팬 제작 도구이며 GungHo Online Entertainment 및 LET IT DIE 제작·배급사와 관련이 없습니다. 게임 원본 파일은 포함하지 않습니다. 사용자는 적법하게 설치한 Steam 오프라인판 5.0.1.0 파일에만 사용해야 합니다.

소스 코드는 [MIT License](./LICENSE)로 배포됩니다. 게임명, 상표 및 게임 데이터에 대한 권리는 각 권리자에게 있습니다.

## 명령줄

```powershell
node .\lid-justguard.js status
node .\lid-justguard.js backup
node .\lid-justguard.js apply stock off
node .\lid-justguard.js apply soft on
node .\lid-justguard.js apply wide on
node .\lid-justguard.js apply iron on
node .\lid-justguard.js restore
```

설치 폴더 직접 지정 예시:

```powershell
node .\lid-justguard.js status --game "C:\Program Files (x86)\Steam\steamapps\common\LET IT DIE"
```
