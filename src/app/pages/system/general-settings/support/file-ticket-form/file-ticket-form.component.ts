import {
  Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef,
} from '@angular/core';
import { Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { FormBuilder } from '@ngneat/reactive-forms';
import { untilDestroyed, UntilDestroy } from '@ngneat/until-destroy';
import { TranslateService } from '@ngx-translate/core';
import _ from 'lodash';
import { of, Observable } from 'rxjs';
import {
  filter, map, switchMap, debounceTime,
} from 'rxjs/operators';
import { NewTicketType } from 'app/enums/new-ticket-type.enum';
import { helptextSystemSupport as helptext } from 'app/helptext/system/support';
import { Job } from 'app/interfaces/job.interface';
import { Option } from 'app/interfaces/option.interface';
import {
  CreateNewTicket, NewTicketResponse,
} from 'app/interfaces/support.interface';
import { DialogFormConfiguration } from 'app/pages/common/entity/entity-dialog/dialog-form-configuration.interface';
import { EntityDialogComponent } from 'app/pages/common/entity/entity-dialog/entity-dialog.component';
import { EntityJobComponent } from 'app/pages/common/entity/entity-job/entity-job.component';
import { SystemGeneralService, WebSocketService, DialogService } from 'app/services';
import { IxSlideInService } from 'app/services/ix-slide-in.service';

@UntilDestroy()
@Component({
  selector: 'app-file-ticket-form',
  templateUrl: './file-ticket-form.component.html',
  styleUrls: ['./file-ticket-form.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTicketFormComponent implements OnInit {
  isFormLoading = false;
  form = this.fb.group({
    token: ['', [Validators.required]],
    category: ['', [Validators.required]],
    type: [NewTicketType.Bug, Validators.required],
    attach_debug: [false],
    title: ['', Validators.required],
    body: ['', Validators.required],
    screenshot: [null as FileList],
  });
  typeOptions$ = of([
    { label: this.translate.instant('Bug'), value: NewTicketType.Bug },
    { label: this.translate.instant('Feature'), value: NewTicketType.Feature },
  ]);
  categoryOptions$: Observable<Option[]> = this.getCategories();
  tooltips = {
    token: helptext.token.tooltip,
    type: helptext.type.tooltip,
    category: helptext.category.tooltip,
    attach_debug: helptext.attach_debug.tooltip,
    title: helptext.title.tooltip,
    body: helptext.body.tooltip,
    screenshot: helptext.screenshot.tooltip,
  };
  private readonly FILE_SIZE_LIMIT_50Mb = 52428800;
  private fileList: FileList;
  private apiEndPoint: string = '/_upload?auth_token=' + this.ws.token;

  constructor(
    private ws: WebSocketService,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService,
    private matDialog: MatDialog,
    private sysGeneralService: SystemGeneralService,
    private slideIn: IxSlideInService,
    private dialog: DialogService,
  ) {
    this.restoreToken();
  }

  ngOnInit(): void {
    this.isFormLoading = false;

    this.form.get('token').value$.pipe(
      filter((token) => !!token),
      untilDestroyed(this),
    ).subscribe((token) => {
      this.sysGeneralService.setTokenForJira(token);
    });

    this.form.get('screenshot').valueChanges.pipe(
      untilDestroyed(this),
    ).subscribe((fileList: FileList) => {
      this.fileList = fileList;
      const exceedLimitFile = fileList && [...fileList].some((file) => file.size >= this.FILE_SIZE_LIMIT_50Mb);
      if (exceedLimitFile) {
        this.fileList = null;
        this.form.patchValue({ screenshot: null });
        this.form.get('screenshot').setErrors({
          ixManualValidateError: {
            message: this.translate.instant('File size is limited to 50 MiB.'),
          },
        });
        this.cdr.markForCheck();
      } else {
        this.form.get('screenshot').setErrors(null);
        this.cdr.markForCheck();
      }
    });
  }

  getCategories(): Observable<Option[]> {
    return this.form.get('token').value$.pipe(
      filter((token) => !!token),
      debounceTime(300),
      switchMap((token) => this.ws.call('support.fetch_categories', [token])),
      map((choices) => {
        let options: Option[] = [];
        for (const property in choices) {
          if (choices.hasOwnProperty(property)) {
            options.push({ label: property, value: choices[property] });
          }
        }
        options = _.sortBy(options, ['label']);
        return options;
      }),
    );
  }

  restoreToken(): void {
    const token = this.sysGeneralService.getTokenForJira();
    if (token) {
      this.form.patchValue({ token });
    }
  }

  onSubmit(): void {
    const values = this.form.value;

    const payload = {
      category: values.category,
      title: values.title,
      body: values.body,
      type: values.type,
      token: values.token,
    } as CreateNewTicket;

    if (values.attach_debug) {
      payload.attach_debug = values.attach_debug;
    }

    this.isFormLoading = true;

    this.openDialog(payload);
  }

  openDialog(payload: CreateNewTicket): void {
    const dialogRef = this.matDialog.open(EntityJobComponent, {
      data: {
        title: this.translate.instant('Ticket'),
        closeOnClickOutside: true,
      },
    });
    dialogRef.componentInstance.setCall('support.new_ticket', [payload]);
    dialogRef.componentInstance.submit();
    dialogRef.componentInstance.success.pipe(
      untilDestroyed(this),
    ).subscribe((res: Job<NewTicketResponse>) => {
      let ticket: NewTicketResponse;
      if (res.result) {
        ticket = res.result;
      }
      if (res.method === 'support.new_ticket' && this.fileList?.length) {
        for (const file of Array.from(this.fileList)) {
          const formData: FormData = new FormData();
          formData.append('data', JSON.stringify({
            method: 'support.attach_ticket',
            params: [{
              ticket: res.result.ticket,
              filename: file.name,
              token: payload.token,
            }],
          }));
          formData.append('file', file);
          dialogRef.componentInstance.wspost(this.apiEndPoint, formData);
          dialogRef.componentInstance.success.pipe(untilDestroyed(this)).subscribe(() => {
            this.resetForm();
          });
          dialogRef.componentInstance.failure.pipe(untilDestroyed(this)).subscribe((res) => {
            dialogRef.componentInstance.setDescription(res.error);
          });
        }
        dialogRef.close();
        this.slideIn.close();
        this.openSuccessDialog(ticket);
      } else {
        dialogRef.close();
        this.slideIn.close();
        this.openSuccessDialog(ticket);
      }
    });
    dialogRef.componentInstance.failure.pipe(untilDestroyed(this)).subscribe((res) => {
      this.isFormLoading = false;
      dialogRef.componentInstance.setDescription(res.error);
    });
  }

  resetForm(): void {
    this.isFormLoading = false;
    this.form.reset();
    this.form.patchValue({ type: NewTicketType.Bug });
  }

  openSuccessDialog(params: NewTicketResponse): void {
    const conf: DialogFormConfiguration = {
      title: this.translate.instant('Ticket'),
      message: this.translate.instant('Your ticket has been submitted successfully'),
      fieldConfig: [],
      cancelButtonText: this.translate.instant('Close'),
      saveButtonText: this.translate.instant('Open Ticket'),
      customSubmit: (entityDialog: EntityDialogComponent) => {
        entityDialog.dialogRef.close();
        window.open(params.url, '_blank');
        this.dialog.closeAllDialogs();
      },
    };
    this.dialog.dialogForm(conf);
  }
}
