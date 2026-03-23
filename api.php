<?php
/**
 * WB3 ROM Analyzer — Local File API
 * Serves project files and handles saves. Only for local use (php -S).
 */

// Allow fetch from tools/ subdirectory
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

$PROJECTS_DIR = __DIR__ . '/projects';
if (!is_dir($PROJECTS_DIR)) mkdir($PROJECTS_DIR, 0755, true);

$action  = $_GET['action']  ?? '';
$project = $_GET['project'] ?? '';

// Sanitize project name — alphanumeric, dash, underscore only
$project = preg_replace('/[^a-zA-Z0-9_\-]/', '', $project);

// ── Helpers ──────────────────────────────────────────────────────────

function projectDir(string $name): string {
    global $PROJECTS_DIR;
    return $PROJECTS_DIR . '/' . $name;
}

/** Find first file matching extensions inside a directory. */
function findByExt(string $dir, array $exts): ?string {
    foreach (glob($dir . '/*') as $f) {
        if (in_array(strtolower(pathinfo($f, PATHINFO_EXTENSION)), $exts)) return $f;
    }
    return null;
}

function projectMeta(string $dir): array {
    $rom = findByExt($dir, ['sms', 'zip']);
    $asm = findByExt($dir, ['asm']);
    $json = $dir . '/map.json';
    return [
        'romFile'  => $rom  ? basename($rom)  : null,
        'asmFile'  => $asm  ? basename($asm)  : null,
        'hasJson'  => file_exists($json),
        'jsonSaved'=> file_exists($json) ? date('Y-m-d H:i:s', filemtime($json)) : null,
        'romSize'  => $rom  ? filesize($rom)  : null,
        'asmLines' => $asm  ? count(file($asm)) : null,
    ];
}

function ok(mixed $data = []): void {
    header('Content-Type: application/json');
    echo json_encode(array_merge(['ok' => true], is_array($data) ? $data : []));
}

function fail(string $msg, int $code = 400): void {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => $msg]);
}

// ── Router ───────────────────────────────────────────────────────────

switch ($action) {

    // List all projects with their file status
    case 'list_projects':
        $list = [];
        foreach (glob($PROJECTS_DIR . '/*', GLOB_ONLYDIR) as $dir) {
            $list[] = array_merge(['name' => basename($dir)], projectMeta($dir));
        }
        ok(['projects' => $list]);
        break;

    // Create a new empty project folder
    case 'create_project':
        if (!$project) { fail('Missing project name'); break; }
        $dir = projectDir($project);
        if (is_dir($dir)) { fail('Project already exists'); break; }
        mkdir($dir, 0755, true);
        ok(['project' => $project]);
        break;

    // Delete a project and all its files
    case 'delete_project':
        if (!$project) { fail('Missing project name'); break; }
        $dir = projectDir($project);
        if (!is_dir($dir)) { fail('Project not found', 404); break; }
        array_map('unlink', glob($dir . '/*'));
        rmdir($dir);
        ok();
        break;

    // Project metadata (what files exist, sizes, etc.)
    case 'project_info':
        if (!$project) { fail('Missing project name'); break; }
        $dir = projectDir($project);
        if (!is_dir($dir)) { fail('Project not found', 404); break; }
        ok(projectMeta($dir));
        break;

    // Serve ROM, ASM or JSON as binary/text
    case 'get_file':
        $type = $_GET['type'] ?? '';
        if (!$project) { fail('Missing project'); break; }
        $dir = projectDir($project);
        if (!is_dir($dir)) { fail('Project not found', 404); break; }

        $file = match ($type) {
            'rom'  => findByExt($dir, ['sms', 'zip']),
            'asm'  => findByExt($dir, ['asm']),
            'json' => (file_exists($dir . '/map.json') ? $dir . '/map.json' : null),
            default => null,
        };

        if (!$file || !file_exists($file)) { fail('File not found', 404); break; }

        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $mime = match ($ext) {
            'json', 'asm' => 'text/plain; charset=utf-8',
            'zip'         => 'application/zip',
            default       => 'application/octet-stream',
        };

        header('Content-Type: ' . $mime);
        header('Content-Disposition: inline; filename="' . basename($file) . '"');
        header('Content-Length: ' . filesize($file));
        readfile($file);
        exit;

    // Save JSON map (POST body = raw JSON)
    case 'save_json':
        if (!$project) { fail('Missing project'); break; }
        $dir = projectDir($project);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);  // auto-create if missing
        }
        $body = file_get_contents('php://input');
        if (!$body) { fail('Empty body'); break; }
        json_decode($body);
        if (json_last_error() !== JSON_ERROR_NONE) { fail('Invalid JSON: ' . json_last_error_msg()); break; }
        // Backup previous map if it exists
        $dest = $dir . '/map.json';
        if (file_exists($dest)) copy($dest, $dest . '.bak');
        file_put_contents($dest, $body);
        ok(['saved' => 'map.json', 'bytes' => strlen($body), 'at' => date('Y-m-d H:i:s')]);
        break;

    // Upload ROM or ASM file (multipart/form-data)
    case 'upload_file':
        if (!$project) { fail('Missing project'); break; }
        $dir = projectDir($project);
        if (!is_dir($dir)) mkdir($dir, 0755, true);

        if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            fail('Upload error: ' . ($_FILES['file']['error'] ?? 'no file')); break;
        }

        $origName = basename($_FILES['file']['name']);
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

        if (!in_array($ext, ['sms', 'zip', 'asm'])) {
            fail("File type .$ext not allowed. Use .sms, .zip or .asm"); break;
        }

        // Remove old file of same type before saving new one
        $old = findByExt($dir, [$ext === 'asm' ? 'asm' : 'sms', 'zip']);
        if ($old && $ext !== 'asm') @unlink($old);
        if ($old && $ext === 'asm') @unlink($old);

        $dest = $dir . '/' . $origName;
        move_uploaded_file($_FILES['file']['tmp_name'], $dest);
        ok(['file' => $origName, 'bytes' => filesize($dest)]);
        break;

    default:
        fail('Unknown action: ' . htmlspecialchars($action));
}
