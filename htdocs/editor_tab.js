var editor = function () {

    var show_terse_dates_,
        new_notebook_prefix_ = "Notebook ",
        github_nonfork_warning = ["GitHub returns the same notebook if you fork a notebook more than once, so you are seeing your old fork of this notebook.",
                                  "If you want to fork the latest version, open your fork in GitHub (through the Advanced menu) and delete it. Then fork the notebook again."].join(' '),
        NOTEBOOK_LOAD_FAILS = 5,
        tree_controller;
    
    function get_notebook_info(gistname) {
        return tree_controller_.get_notebook_info(gistname);
    }

    function set_notebook_info(gistname, value) {
        tree_controller_.set_notebook_info(gistname, value);
    }

    function update_url(opts) {
        var url = ui_utils.make_url('edit.html', opts);
        window.history.replaceState("rcloud.notebook", null, url);
        return rcloud.api.set_url(url);
    }

    var result = {
        init: function(opts) {
            var that = this;
            username_ = rcloud.username();

            var tree_model = new notebook_tree_model(
                rcloud.username(), 
                show_terse_dates_
            );

            tree_controller_ = new notebook_tree_controller(tree_model,
                new notebook_tree_view(tree_model)
            );

            tree_controller_.notebook_open.attach(function (sender, args) {
                result.open_notebook(
                    args.gistname,
                    args.version,
                    args.source,
                    args.selroot,
                    args.new_window
                );
            });  

            var promise = tree_controller_.load_everything().then(function() {
                if(opts.notebook) { // notebook specified in url
                    return that.load_notebook(opts.notebook, opts.version, opts.source,
                                              true, false, ui_utils.make_url('edit.html'));
                } else if(!opts.new_notebook && current_.notebook) {
                    return that.load_notebook(current_.notebook, current_.version)
                        .catch(function(xep) {
                            // if loading fails for a reason that is not actually a loading problem
                            // then don't keep trying.
                            if(xep.from_load)
                                rcloud.config.clear_recent_notebook(current_.notebook)
                                .then(open_last_loadable);
                            else throw xep;
                        });
                }
                else
                    return that.new_notebook();
            });

            $('.dropdown-toggle.recent-btn').dropdown();

            $('.recent-btn').click(function(e) {
                e.preventDefault();
                e.stopPropagation();
            });

            $('#new-notebook').click(function(e) {
                e.preventDefault();
                e.stopPropagation();
                if(e.metaKey || e.ctrlKey) {
                    var url = ui_utils.make_url('edit.html', {new_notebook: true});
                    window.open(url, "_blank");
                }
                else
                    that.new_notebook();
            });
            var snf = result.star_notebook;
            RCloud.UI.navbar.control('star_notebook').set_star_unstar(snf.bind(this, true), snf.bind(this, false));
            return promise;
        },
        // partial access to state, for add-ons.  (should be explicit model)
        username: function() {
            return username_;
        },
        gist_sources: function() {
            return gist_sources_;
        },
        num_stars: function(gistname) {
            return tree_controller_.get_notebook_star_count(gistname);
        },
        set_num_stars: function(gistname, count) {
            tree_controller_.set_notebook_star_count(gistname, count);
        },
        num_stars_exists: function(notebook_id) {
            return tree_controller_.notebook_star_count_exists(notebook_id);
        },
        i_starred: function(gistname) {
            return tree_controller_.is_notebook_starred_by_current_user(gistname);
        },
        current: function() {
            return current_;
        },
        get_notebook_info: function(gistname) {
            return get_notebook_info(gistname);
        },
        // missing: friends, featured, histories
        fatal_reload: function(message) {
            var url = ui_utils.make_url('edit.html', {notebook: current_.notebook, version: current_.version});
            message = "<p>Sorry, RCloud's internal state has become inconsistent.  Please reload to return to a working state.</p><p>" + message + "</p>";
            RCloud.UI.fatal_dialog(message, "Reload", url);
        },
        find_next_copy_name: function(name) {
            return tree_controller_.find_next_copy_name(username_, name);
        },
        load_notebook: function(gistname, version, source, selroot, push_history, fail_url) {
            version = version || null;
            var that = this;
            var before;
            var last_notebook = shell.gistname(), last_version = shell.version();
            if(source) {
                if(source==='default')
                    source = null; // drop it
                else if(gist_sources_.indexOf(source)<0) {
                    before = Promise.reject(new Error(
                        "Invalid gist source '" + source + "'; available sources are: " +
                            gist_sources_.join(', ')));
                } else if(!get_notebook_info(gistname)) {
                    set_notebook_info(gistname, { source: source });
                    before = rcloud.set_notebook_property(gistname, "source", source);
                }
                // silently ignore valid source if notebook already known
            }
            before = before || Promise.resolve(undefined);
            selroot = selroot || true;

            return before.then(function() {
                return shell.load_notebook(gistname, version)
                    .then(that.load_callback({version: version,
                                              source: source,
                                              selroot: selroot,
                                              push_history: push_history}));
            })
                .catch(function(xep) {
                    // session has been reset, must reload notebook
                    return Promise.all([
                        rcloud.load_notebook(last_notebook, last_version),
                        shell.improve_load_error(xep, gistname, version)
                    ]).spread(function(_, message) {
                        RCloud.UI.fatal_dialog(message, "Continue", fail_url);
                        throw xep;
                    });
                });
        },
        open_notebook: function(gistname, version, source, selroot, new_window) {
            // really just load_notebook except possibly in a new window
            if(new_window) {
                var url = ui_utils.make_url('edit.html', {notebook: gistname, version: version, source: source});
                window.open(url, "_blank");
            } else {
                this.load_notebook(gistname, version, source, selroot, null);
            }
        },
        new_notebook_prefix: function(_) {
            if(arguments.length) {
                new_notebook_prefix_ = _;
                return this;
            } else { 
                return new_notebook_prefix_;
            }
        },
        new_notebook: function() {
            var that = this;

            return Promise.cast(tree_controller_.find_next_copy_name(username_, new_notebook_prefix_ + '1'))
                .then(shell.new_notebook.bind(shell))
                .then(function(notebook) {
                    tree_controller_.set_visibility(notebook.id, true);
                    that.star_notebook(true, {notebook: notebook, make_current: true, version: null});
                });
        },
        validate_name: function(newname) {
            return newname && !_.some(newname.split('/'), Notebook.empty_for_github); // not null and no part of path is whitespace
        },
        rename_notebook: function(desc) {
            return shell.rename_notebook(desc);
        },
        tag_version: function(id, version, tag) {
            if(Notebook.empty_for_github(tag))
                tag = null;
            return rcloud.tag_notebook_version(id, version, tag)
                .then(function(ret) {
                    if(!ret)
                        return Promise.resolve(undefined);
                    var history = histories_[id];
                    for(var i=0; i<history.length; ++i) {
                        if (history[i].version === version) {
                            history[i].tag = tag;
                        }
                        if(history[i].tag === tag && history[i].version != version) {
                            history[i].tag = undefined;
                        }
                    }
                    var promises = [];
                    if(id === current_.notebook && version === current_.version) {
                        promises.push(update_url({notebook: id, version: version, tag: tag}));
                    }
                    promises.push(RCloud.UI.share_button.update_link());
                    return Promise.all(promises);
                });
        },
        for_each_notebook: function(node, data, leaff, combinef) {
            var that = this;
            if(node.children && node.children.length) {
                node.children.forEach(function(child) {
                    that.for_each_notebook(child, combinef ? combinef(child, data) : undefined,
                                           leaff, combinef);
                });
            }
            else {
                leaff(node, data);
            }
        },
        star_notebook: function(star, opts) {
            var that = this;
            // if opts has user and gistname use those
            // else if opts has notebook, use notebook id & user
            // else use current notebook & user
            opts = opts || {};
            var gistname = opts.gistname ||
                    opts.notebook&&opts.notebook.id ||
                    current_.notebook;
            var user = opts.user ||
                    opts.notebook&&opts.notebook.user&&opts.notebook.user.login ||
                    that.get_notebook_info(gistname).username;
            // keep selected if was (but don't try to select a removed notebook)
            if(gistname === current_.notebook && opts.selroot === undefined)
                opts.selroot = true;
            if(star) {
                return rcloud.stars.star_notebook(gistname).then(function(count) {
                    that.set_num_stars(gistname, count);
                    var entry = that.get_notebook_info(gistname);
                    if(!entry.description && !opts.notebook) {
                        console.log("attempt to star notebook we have no record of",
                                    tree_controller_.node_id('interests', user, gistname));
                        throw new Error("attempt to star notebook we have no record of",
                                        tree_controller_.node_id('interests', user, gistname));
                    }
                    tree_controller_.add_interest(user, gistname);

                    // this is a new friend:
                    if(tree_controller_.get_my_star_count_by_friend(user) === 1) 
                        tree_controller_.toggle_folder_friendness(user);

                    var p;
                    if(opts.notebook) {
                        if(opts.make_current)
                            return that.load_callback({
                                version: opts.version,
                                is_change: opts.is_change || false,
                                selroot: 'interests'})(opts.notebook);
                        else
                            p = tree_controller_.update_notebook_from_gist(opts.notebook, opts.notebook.history, opts.selroot);
                    }
                    else {
                        p = tree_controller_.update_notebook_view(user, gistname, entry, opts.selroot);
                    }
                    return p.return(opts.notebook);
                });
            } else {
                return rcloud.stars.unstar_notebook(gistname).then(function(count) {
                    that.set_num_stars(gistname, count);
                    tree_controller_.remove_interest(user, gistname);

                    // user is no longer a friend
                    if(!tree_controller_.user_is_friend(user))
                        tree_controller_.toggle_folder_friendness(user);

                    tree_controller_.unstar_notebook_view(user, gistname, opts.selroot);
                });
            }
        },
        remove_notebook_info: function(user, gistname) {
            return user === username_ ?
                rcloud.config.remove_notebook(gistname) :
                Promise.resolve();
        },
        remove_notebook: function(user, gistname) {
            var that = this;
            return (!this.i_starred(gistname) ? Promise.resolve() :
                    this.star_notebook(false, {user: user, gistname: gistname, selroot: false}))
                .then(function() {
                    that.remove_notebook_info(user, gistname);
                    tree_controller_.remove_notebook_view(user, gistname);
                    var promise = rcloud.config.clear_recent_notebook(gistname);
                    if(gistname === current_.notebook)
                        promise = promise.then(that.open_last_loadable);
                    return promise;
                });
        },
        highlight_imported_notebooks: function(notebooks) {
            return tree_controller_.highlight_notebooks(notebooks);           
        },
        set_notebook_visibility: function(gistname, visible) {
            var promise = tree_controller_.set_visibility(gistname, visible);
            tree_controller_.update_notebook_view(username_, gistname, this.get_notebook_info(gistname), false);
            return promise;
        },
        set_terse_dates: function(val) {
            this.show_terse_dates_ = val;
        },
        star_and_show: function(notebook, make_current, is_change) {
            return this.star_notebook(true, {notebook: notebook,
                                             make_current: make_current,
                                             is_change: is_change,
                                             version: null})
                .return(notebook.id)
                .bind(this)
                .then(function(gistname) {
                    return this.set_notebook_visibility(gistname, true);
                })
                .return(notebook);
        },
        show_history: function(node, opts) {        
            tree_controller_.show_history(node, opts);
        },
        fork_notebook: function(is_mine, gistname, version) {
            var that = this;
            return shell.fork_notebook(is_mine, gistname, version)
                .bind(this)
                .then(function(notebook) {
                    if(that.get_notebook_info(notebook.id)) {
                        alert(github_nonfork_warning);
                    }
                    return this.star_and_show(notebook, true, !!version);
                });
        },
        fork_folder: function(node, match, replace) {
            var that = this;
            var is_mine = node.user === that.username();
            var promises = [];
            editor.for_each_notebook(node, null, function(node) {
                var promise_fork;
                if(is_mine)
                    promise_fork = shell.fork_my_notebook(node.gistname, null, false, function(desc) {
                        return Promise.resolve(desc.replace(match, replace));
                    });
                else
                    promise_fork = rcloud.fork_notebook(node.gistname);
                promises.push(promise_fork.then(function(notebook) {
                    if(that.get_notebook_info(notebook.id))
                        return notebook.description;
                    else
                        return editor.star_and_show(notebook, false, false);
                }));
            });
            return Promise.all(promises).then(function(results) {
                var already = [], forked = [];
                for(var i = 0; i < results.length; ++i) {
                    if(_.isString(results[i]))
                        already.push(results[i]);
                    else
                        forked.push(results[i].description);
                }
                if(already.length) {
                    var lines = ["You already forked the following " + already.length + " notebooks:"]
                            .concat(already, '', github_nonfork_warning);
                    if(promises.length > already.length)
                        lines = lines.concat("", "You forked " + forked.length + " notebooks.", forked);

                    alert(lines.join('\n'));
                }
            });
        },
        revert_notebook: function(is_mine, gistname, version) {
            if(!is_mine)
                return Promise.reject(new Error("attempted to revert notebook not mine"));
            if(!version)
                return Promise.reject(new Error("attempted to revert current version"));
            return shell.revert_notebook(gistname, version)
                .then(this.load_callback({is_change: true, selroot: true}));
        },
        pull_and_replace_notebook: function(from_notebook) {
            return shell.pull_and_replace_notebook(from_notebook)
                .then(this.load_callback({is_change: true, selroot: true}));
        },
        step_history_undo: function() {
            var previous_version = tree_controller_.get_previous();

            if(!_.isUndefined(previous_version)) {
                RCloud.UI.shortcut_manager.disable(['history_undo', 'history_redo']);
                this.load_notebook(current_.notebook, previous_version).finally(function() {
                    RCloud.UI.shortcut_manager.enable(['history_undo', 'history_redo']);
                });
            }
        },
        step_history_redo: function() {
            var next_version = tree_controller_.get_next();

            if(!_.isUndefined(next_version)) {
                RCloud.UI.shortcut_manager.disable(['history_undo', 'history_redo']);
                this.load_notebook(current_.notebook, next_version).finally(function() {
                    RCloud.UI.shortcut_manager.enable(['history_undo', 'history_redo']);
                });
            }
        },
        update_recent_notebooks: function(data) {
            var that = this;
            var sorted = _.chain(data)
                .pairs()
                .filter(function(kv) {
                    return kv[0] != 'r_attributes' && kv[0] != 'r_type' && !_.isEmpty(that.get_notebook_info(kv[0])) ;
                })
                .map(function(kv) { return [kv[0], Date.parse(kv[1])]; })
                .sortBy(function(kv) { return kv[1] * -1; })
                .value();

            sorted.shift();//remove the first item
            sorted = sorted.slice(0, 20); //limit to 20 entries

            $('.recent-notebooks-list a').each(function() {
                $(this).off('click');
            });

            $('.recent-notebooks-list').empty();

            // premature optimization? define function outside loop to make jshint happy
            var click_recent = function(e) {
                e.stopPropagation();
                e.preventDefault();
                var gist = $(e.currentTarget).data('gist');
                $('.dropdown-toggle.recent-btn').dropdown("toggle");
                result.open_notebook(gist, undefined, undefined, undefined, e.metaKey || e.ctrlKey);
            };
            for(var i = 0; i < sorted.length; i ++) {
                var li = $('<li></li>');
                li.appendTo($('.recent-notebooks-list'));
                var currentNotebook = that.get_notebook_info(sorted[i][0]);
                var anchor = $('<a data-gist="'+sorted[i][0]+'"></a>');
                var desc = truncateNotebookPath(currentNotebook.description, 40);
                var $desc;

                anchor.addClass('ui-all')
                    .append($('<span class="username">'+currentNotebook.username+'</span>'))
                    .append($desc = $('<span class="description">'+desc+'</span>'))
                    .appendTo(li);

                if(currentNotebook.source)
                    $desc.addClass('foreign-notebook');
                else if(!currentNotebook.visible)
                    $desc.addClass('hidden-notebook');

                anchor.click(click_recent);
            }

            function truncateNotebookPath(txt, chars) {
                if(!txt || typeof txt === 'undefined' || txt.length === 0 ){
                    return 'something went wrong';
                }

                var foldersReplaced = 0;
                var folders = txt.split('/');
                var foldersLength = folders.length -1;
                var text = txt;
                var folderStringLength = 3; //
                var trimReplacements = false;

                return doTrim();

                function doTrim() {
                    if(text.length > chars) {
                        //if folders
                        if(folders.length > 2) {
                            //replace each dir with ../
                            if(foldersLength - foldersReplaced >1 && !trimReplacements){
                                foldersReplaced ++;
                                folders.shift();
                                var fldrs = '';
                                for(var a = 0; a < foldersReplaced; a ++) {
                                    fldrs += '../';
                                }
                                text = fldrs + folders.join('/');
                                return doTrim();
                            }
                            //folder replacements exhausted, drop the first replacement and try
                            else if(trimReplacements) {
                                trimReplacements = true;
                                text = text.slice(3);
                                foldersReplaced --;
                                var timeToTrimFolders;
                                return doTrim();
                            }
                        }
                        //if no folders
                        else if(folders.length === 2){
                            text = text.substring(0, text.length - 6);
                            text += '...';
                            return doTrim();
                        }
                        else{
                            text = text.substring(0, text.length - 6);
                            text += '...';
                            return doTrim();
                        }
                    }
                    return text;
                }
            }
        },

        open_last_loadable: function() {
            var tries_left = NOTEBOOK_LOAD_FAILS;
            RCloud.UI.session_pane.allow_clear = false;
            return rcloud.config.get_recent_notebooks()
                .then(function(recent) {
                    var sorted = _.chain(recent)
                            .pairs()
                            .filter(function(kv) { return kv[0] != 'r_attributes' && kv[0] != 'r_type'; })
                            .map(function(kv) { return [kv[0], Date.parse(kv[1])]; })
                            .sortBy(function(kv) { return kv[1]; })
                            .value();
                    // a recursive error handler
                    function try_last() {
                        var last = sorted.pop();
                        if(!last)
                            return result.new_notebook();
                        else
                            return result.load_notebook(last[0], null)
                            .catch(function(err) {
                                RCloud.UI.session_pane.post_rejection(err);
                                if(/Not Found/.test(err))
                                    rcloud.config.clear_recent_notebook(last);
                                // if we reach the limit, stop trying.  if loading fails for a reason that
                                // is not actually a loading problem then stop trying.
                                if(--tries_left === 0) {
                                    var quit_err = new Error("Failed to load " + NOTEBOOK_LOAD_FAILS + " notebooks. Quitting.");
                                    RCloud.UI.session_pane.post_rejection(quit_err);
                                    return Promise.resolve(false);
                                }
                                else if(err.from_load)
                                    return try_last();
                                else
                                    return Promise.resolve(false);
                            });
                    }
                    return try_last();
                })
                .then(function(res) {
                    RCloud.UI.session_pane.allow_clear = true;
                    return res;
                });
        },

        load_callback: function(opts) {
            var that = this;
            var options = $.extend(
                {version: null,
                 is_change: false,
                 selroot: null,
                 push_history: true}, opts);
            return function(result) {
                current_ = {notebook: result.id, version: options.version};
                var tag;
                var find_version = _.find(result.history, function(x) { return x.version === options.version; });
                if(find_version)
                    tag = find_version.tag;
                rcloud.config.set_current_notebook(current_);
                rcloud.config.set_recent_notebook(result.id, (new Date()).toString())
                .then(function(){
                    return rcloud.config.get_recent_notebooks();
                })
                .then(function(data){
                    that.update_recent_notebooks(data);
                });

                // need to know if foreign before we can do many other things
                var promise_source = options.source ? Promise.resolve(undefined)
                        : rcloud.get_notebook_property(result.id, 'source').then(function(source) {
                            if(!that.get_notebook_info(result.id))
                                that.set_notebook_info(result.id, {});
                            options.source = that.get_notebook_info(result.id).source = source;
                        });
                return promise_source.then(function() {
                     var promises = []; // fetch and setup various ui "in parallel"
                     promises.push(RCloud.UI.share_button.update_link());
                     document.title = result.description + " - RCloud";
                     promises.push(update_url({notebook: result.id, version: options.version, source: options.source, tag:tag}));

                     var history;
                     // when loading an old version you get truncated history
                     // we don't want that, even if it means an extra fetch
                     if(options.version)
                         history = null;
                     else
                         history = result.history;

                     promises.push((that.num_stars_exists(result.id) ? Promise.resolve(undefined)
                                    : rcloud.stars.get_notebook_star_count(result.id).then(function(count) {
                                        that.num_stars(result.id, count);
                                    })).then(function() {
                                        return tree_controller_.update_notebook_from_gist(result, history, options.selroot);
                                    }));

                     RCloud.UI.comments_frame.set_foreign(!!options.source);
                     RCloud.UI.advanced_menu.enable('pull_and_replace_notebook', !shell.notebook.model.read_only());
                     promises.push(RCloud.UI.comments_frame.display_comments());
                     promises.push(rcloud.is_notebook_published(result.id).then(function(p) {
                         RCloud.UI.advanced_menu.check('publish_notebook', p);
                         RCloud.UI.advanced_menu.enable('publish_notebook', result.user.login === username_);
                     }));

                     return Promise.all(promises).return(result);
                 });
            };
        }
    };
    return result;
}();
