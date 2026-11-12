function toggleClaimGroup(btn) {
  var group = btn.closest('.pd-claim-group');
  if (!group) return;
  var isExpanded = group.classList.toggle('expanded');
  var countBtn = group.querySelector('.pd-claim-dependent-count');
  var collapseBtn = group.querySelector('.pd-claim-collapse-btn');
  if (countBtn) {
    var span = countBtn.querySelector('span');
    if (span && isExpanded) {
      span.textContent = '点击收起从属权利要求 ▲';
    } else if (span) {
      var count = group.querySelectorAll('.pd-claim-dependents .pd-claim-item').length;
      span.textContent = '点击展开 ' + count + ' 项从属权利要求 ▼';
    }
    countBtn.style.display = isExpanded ? 'none' : '';
  }
  if (collapseBtn) {
    collapseBtn.style.display = isExpanded ? '' : 'none';
  }
  updateExpandAllBtn(btn);
}

function toggleAllClaimGroups(btn) {
  var panel = btn.closest('.pd-tab-panel');
  if (!panel) return;
  var list = panel.querySelector('.pd-claims-list');
  if (!list) return;
  var groups = list.querySelectorAll('.pd-claim-group');
  var isAllExpanded = list.classList.contains('expanded-all');
  list.classList.toggle('expanded-all', !isAllExpanded);
  groups.forEach(function(g) {
    if (!isAllExpanded) {
      g.classList.add('expanded');
    } else {
      g.classList.remove('expanded');
    }
    var countBtn = g.querySelector('.pd-claim-dependent-count');
    var collapseBtn = g.querySelector('.pd-claim-collapse-btn');
    if (countBtn) {
      var span = countBtn.querySelector('span');
      if (span) {
        var count = g.querySelectorAll('.pd-claim-dependents .pd-claim-item').length;
        if (!isAllExpanded) {
          span.textContent = '点击收起从属权利要求 ▲';
        } else {
          span.textContent = '点击展开 ' + count + ' 项从属权利要求 ▼';
        }
      }
      countBtn.style.display = !isAllExpanded ? 'none' : '';
    }
    if (collapseBtn) {
      collapseBtn.style.display = !isAllExpanded ? '' : 'none';
    }
  });
  if (isAllExpanded) {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>展开全部从权';
  } else {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>收起全部从权';
  }
}

function updateExpandAllBtn(btn) {
  var panel = btn.closest('.pd-tab-panel');
  if (!panel) return;
  var list = panel.querySelector('.pd-claims-list');
  if (!list) return;
  var expandBtn = panel.querySelector('.pd-claim-expand-btn');
  if (!expandBtn) return;
  var groups = list.querySelectorAll('.pd-claim-group');
  var expandedGroups = list.querySelectorAll('.pd-claim-group.expanded');
  var allExpanded = groups.length > 0 && expandedGroups.length === groups.length;
  if (allExpanded) {
    list.classList.add('expanded-all');
    expandBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>收起全部从权';
  } else {
    list.classList.remove('expanded-all');
    expandBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>展开全部从权';
  }
}
