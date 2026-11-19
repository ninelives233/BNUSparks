const adminPlaceholderState = {
    page: 1,
    q: '',
    collegeId: '',
    hasMaterials: '',
    hasConflict: ''
};

let adminPlaceholderRequest = 0;

function adminPlaceholderPaths(paths) {
    if (!paths || !paths.length) return '<span class="ap-empty">无所属路径</span>';
    return '<ul class="ap-paths">' + paths.map(path =>
        '<li><span>' + esc(String(path.path || '')) + '</span> ' +
        '<span class="ap-education-level">' + esc(String(path.education_level || '')) + '</span></li>'
    ).join('') + '</ul>';
}

function adminPlaceholderClues(clues) {
    const groups = [
        ['same_college_real', '同院同名真实代码'],
        ['same_college_bnux', '同院同名占位代码'],
        ['cross_college_real', '跨院同名真实代码']
    ];
    return groups.map(([key, label]) => {
        const items = (clues && clues[key]) || [];
        return '<section class="ap-clue-group"><h5>' + esc(label) + '</h5>' +
            (items.length ? items.map(clue =>
                '<div class="ap-clue"><div><code>' + esc(String(clue.code || '')) + '</code> ' +
                '<span>' + esc(String(clue.name || '')) + '</span> ' +
                '<span>' + esc(String(clue.college_name || '')) + '</span> ' +
                '<span>资料 ' + esc(String(clue.material_count ?? 0)) + '</span></div>' +
                adminPlaceholderPaths(clue.paths) +
                '<button type="button" class="admin-btn admin-btn-sm admin-btn-secondary ap-select-target" data-target-id="' +
                esc(String(clue.course_id)) + '" data-target-code="' + esc(String(clue.code || '')) +
                '">设为合并目标</button></div>'
            ).join('') : '<div class="ap-empty">暂无线索</div>') + '</section>';
    }).join('');
}

function adminPlaceholderCard(item) {
    const aliases = item.alias_codes || [];
    return '<article class="admin-pending-card ap-card" data-course-id="' + esc(String(item.id)) + '">' +
        '<div class="ap-card-header"><h4>' + esc(String(item.name || '')) + '</h4>' +
        '<span class="ap-college">' + esc(String(item.college_name || '')) + '</span>' +
        '<span class="ap-counts">资料总计 ' + esc(String(item.material_count ?? 0)) +
        ' / 已过审 ' + esc(String(item.approved_count ?? 0)) +
        ' / 待审 ' + esc(String(item.pending_count ?? 0)) + '</span>' +
        '<code class="ap-code">' + esc(String(item.code || '')) + '</code></div>' +
        '<div class="ap-card-paths"><strong>所属专业路径</strong>' + adminPlaceholderPaths(item.paths) + '</div>' +
        (aliases.length ? '<div class="ap-aliases"><strong>既有别名</strong> ' +
            aliases.map(alias => '<code>' + esc(String(alias)) + '</code>').join(' ') + '</div>' : '') +
        '<div class="ap-conflicts"><h4>冲突线索</h4>' + adminPlaceholderClues(item.conflict_clues) + '</div>' +
        '<div class="ap-actions"><div class="ap-adopt"><label>补正代码 ' +
        '<input class="ap-adopt-input" type="text" autocomplete="off"></label> ' +
        '<button type="button" class="admin-btn admin-btn-sm admin-btn-primary ap-adopt-button">补正代码</button></div>' +
        '<div class="ap-merge"><label>合并到已有课程 ' +
        '<input class="ap-merge-input" type="text" autocomplete="off"></label> ' +
        '<button type="button" class="admin-btn admin-btn-sm admin-btn-secondary ap-merge-button">合并到已有课程</button></div>' +
        '<div class="ap-error" role="alert" aria-live="polite"></div></div></article>';
}

function adminPlaceholderError(error) {
    if (typeof error === 'string') return error;
    return (error && (error.error || error.message || (error.data && error.data.error) ||
        (error.response && error.response.error))) || '操作失败，请重试。';
}

function adminPlaceholderConfirm(message, trigger) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'ap-confirm-overlay';
        overlay.innerHTML = '<div class="ap-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="ap-confirm-title" aria-describedby="ap-confirm-message">' +
            '<h3 id="ap-confirm-title">确认操作</h3><p id="ap-confirm-message"></p>' +
            '<div class="ap-confirm-actions"><button type="button" class="admin-btn admin-btn-secondary ap-confirm-cancel">取消</button>' +
            '<button type="button" class="admin-btn admin-btn-primary ap-confirm-submit">确认</button></div></div>';
        overlay.querySelector('p').textContent = message;
        const cancel = overlay.querySelector('.ap-confirm-cancel');
        const confirm = overlay.querySelector('.ap-confirm-submit');
        const close = result => {
            document.removeEventListener('keydown', onKeydown, true);
            overlay.remove();
            if (trigger.isConnected) trigger.focus();
            resolve(result);
        };
        const onKeydown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(false);
            } else if (event.key === 'Tab') {
                if (event.shiftKey && document.activeElement === cancel) {
                    event.preventDefault();
                    confirm.focus();
                } else if (!event.shiftKey && document.activeElement === confirm) {
                    event.preventDefault();
                    cancel.focus();
                }
            }
        };
        cancel.addEventListener('click', () => close(false));
        confirm.addEventListener('click', () => close(true));
        overlay.addEventListener('click', event => { if (event.target === overlay) close(false); });
        document.addEventListener('keydown', onKeydown, true);
        document.body.appendChild(overlay);
        cancel.focus();
    });
}

async function renderAdminPlaceholders(content, page) {
    if (!content) return;
    adminPlaceholderState.page = Math.max(1, Number(page) || 1);
    const request = ++adminPlaceholderRequest;
    content.innerHTML = '<div class="admin-loading">加载中…</div>';
    const params = new URLSearchParams({
        page: String(adminPlaceholderState.page),
        per_page: '20',
        q: adminPlaceholderState.q,
        college_id: adminPlaceholderState.collegeId,
        has_materials: adminPlaceholderState.hasMaterials,
        has_conflict: adminPlaceholderState.hasConflict
    });
    let data;
    try {
        data = await api('/api/admin/placeholder-courses/?' + params.toString());
        if (data && data.ok === false) throw data;
    } catch (error) {
        if (request === adminPlaceholderRequest) {
            content.innerHTML = '<div class="ap-error" role="alert">' + esc(String(adminPlaceholderError(error))) + '</div>';
        }
        return;
    }
    if (request !== adminPlaceholderRequest) return;
    adminPlaceholderState.page = data.page;
    const option = (value, label, selected) => '<option value="' + esc(String(value)) + '"' +
        (String(value) === String(selected) ? ' selected' : '') + '>' + esc(String(label)) + '</option>';
    content.innerHTML = '<form class="ap-toolbar">' +
        '<label>关键词 <input class="ap-query" type="search" value="' + esc(adminPlaceholderState.q) + '"></label>' +
        '<label>学院 <select class="ap-college-filter">' + option('', '全部学院', adminPlaceholderState.collegeId) +
        (data.colleges || []).map(college => option(college.id, college.name, adminPlaceholderState.collegeId)).join('') + '</select></label>' +
        '<label>资料 <select class="ap-material-filter">' + option('', '全部', adminPlaceholderState.hasMaterials) +
        option('1', '有资料', adminPlaceholderState.hasMaterials) + option('0', '无资料', adminPlaceholderState.hasMaterials) + '</select></label>' +
        '<label>冲突线索 <select class="ap-conflict-filter">' + option('', '全部', adminPlaceholderState.hasConflict) +
        option('1', '有线索', adminPlaceholderState.hasConflict) + option('0', '无线索', adminPlaceholderState.hasConflict) + '</select></label>' +
        '<button type="submit" class="admin-btn admin-btn-sm admin-btn-primary">查询</button> <button type="button" class="admin-btn admin-btn-sm admin-btn-secondary ap-reset">重置</button></form>' +
        '<div class="admin-pending-list ap-list">' +
        ((data.items || []).map(adminPlaceholderCard).join('') || '<div class="ap-empty">没有符合条件的占位课程</div>') + '</div>' +
        adminNumericPager(data.page, data.total_pages, "renderAdminPlaceholders(document.getElementById('adminContent'), ", ")");

    const toolbar = content.querySelector('.ap-toolbar');
    toolbar.addEventListener('submit', event => {
        event.preventDefault();
        adminPlaceholderState.q = toolbar.querySelector('.ap-query').value.trim();
        adminPlaceholderState.collegeId = toolbar.querySelector('.ap-college-filter').value;
        adminPlaceholderState.hasMaterials = toolbar.querySelector('.ap-material-filter').value;
        adminPlaceholderState.hasConflict = toolbar.querySelector('.ap-conflict-filter').value;
        renderAdminPlaceholders(content, 1);
    });
    toolbar.querySelector('.ap-reset').addEventListener('click', () => {
        Object.assign(adminPlaceholderState, { page: 1, q: '', collegeId: '', hasMaterials: '', hasConflict: '' });
        renderAdminPlaceholders(content, 1);
    });
    content.querySelector('.ap-list').addEventListener('click', async event => {
        const button = event.target.closest('button');
        if (!button) return;
        const card = button.closest('.ap-card');
        if (!card) return;
        const mergeInput = card.querySelector('.ap-merge-input');
        const conflictMerge = button.classList.contains('ap-conflict-merge');
        if (button.classList.contains('ap-select-target') || conflictMerge) {
            mergeInput.value = button.dataset.targetCode;
            mergeInput.dataset.targetId = button.dataset.targetId;
            mergeInput.dataset.targetCode = button.dataset.targetCode;
            if (!conflictMerge) {
                mergeInput.focus();
                return;
            }
        }
        const adopt = button.classList.contains('ap-adopt-button');
        if (!adopt && !button.classList.contains('ap-merge-button') && !conflictMerge) return;
        const input = adopt ? card.querySelector('.ap-adopt-input') : mergeInput;
        const value = input.value.trim();
        const errorBox = card.querySelector('.ap-error');
        if (!conflictMerge) errorBox.textContent = '';
        if (!value) {
            errorBox.textContent = adopt ? '请输入要补正的教学代码。' : '请输入合并目标代码。';
            input.focus();
            return;
        }
        if (!await adminPlaceholderConfirm(adopt ? '确认将此占位课程补正为 ' + value + '？' : '确认将此占位课程合并到 ' + value + '？', button)) return;
        errorBox.textContent = '';
        const body = adopt ? { teaching_code: value } :
            (mergeInput.dataset.targetId && mergeInput.dataset.targetCode === value ?
                { target_course_id: Number(mergeInput.dataset.targetId) } : { target_code: value });
        card.querySelectorAll('.ap-adopt-button, .ap-merge-button').forEach(action => { action.disabled = true; });
        try {
            const result = await api('/api/admin/placeholder-courses/' + encodeURIComponent(card.dataset.courseId) +
                (adopt ? '/adopt/' : '/merge-into/'), { method: 'POST', body });
            if (result && result.ok === false) throw result;
        } catch (error) {
            const existing = adopt && error.status === 409 && error.data && error.data.existing_course;
            if (existing && existing.can_merge === false) {
                errorBox.textContent = '该代码属于 ' + (existing.college_name || '其他学院') + '，请联系总管理员核对合并';
            } else if (existing && existing.can_merge) {
                errorBox.textContent = '代码冲突：' + existing.code + ' ' + existing.name + '。请确认是同一课程。';
                const mergeButton = document.createElement('button');
                mergeButton.type = 'button';
                mergeButton.className = 'admin-btn admin-btn-sm admin-btn-secondary ap-conflict-merge';
                mergeButton.textContent = '填入并合并到该课程';
                mergeButton.dataset.targetId = existing.id;
                mergeButton.dataset.targetCode = existing.code;
                errorBox.appendChild(mergeButton);
            } else {
                errorBox.textContent = String(adminPlaceholderError(error));
            }
            card.querySelectorAll('.ap-adopt-button, .ap-merge-button').forEach(action => { action.disabled = false; });
            return;
        }
        try {
            if (typeof clearApiCache === 'function') clearApiCache('/api/courses/tree/');
            if (typeof refreshCourseTree === 'function') await refreshCourseTree();
        } finally {
            renderAdminPlaceholders(content, adminPlaceholderState.page);
        }
    });
}
